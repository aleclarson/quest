const { Readable } = require('readable-stream')
const https = require('https')
const http = require('http')

const urlRE = /(.+):\/\/([^\/\:]+)(?:\:([^\/]+))?(.*)/
const protocols = { http, https }
const noop = Function.prototype
const def = (obj, key, val) =>
  Object.defineProperty(obj, key, { value: val, configurable: true })

module.exports = quest

function quest(method, url, headers) {
  if (http.METHODS.indexOf(method) < 0) {
    throw Error('Unknown HTTP method: ' + method)
  }
  const parts = url.match(urlRE) || []
  const protocol = protocols[parts[1]]
  if (!protocol) {
    throw Error('Unsupported url: ' + url)
  }
  prepareHeaders(headers)
  return protocol.request({
    method,
    host: parts[2],
    port: parts[3],
    path: parts[4] || '/',
    headers,
  })
}

quest.sock = function(path) {
  const sock = Object.create(sockProto)
  sock.path = path
  return sock
}

quest.stream = function(url, headers) {
  const err = new Error()
  const stream = new Readable({
    read: noop, // Push only
  })

  let req
  if (url instanceof http.ClientRequest) {
    req = quest.send(url, headers)
  } else if (typeof url == 'string') {
    req = quest('GET', url, headers)
    err.url = url
    err.headers = headers
  } else {
    throw TypeError('Expected a URL string or a ClientRequest object')
  }

  req.on('close', () => {
    stream.emit('close')
  })

  quest.ok(req, err).then(res => {
    stream.status = res.statusCode
    stream.headers = res.headers
    stream.emit('connect')

    // Pipe the response into our readable stream.
    res.on('error', uhoh)
    res.on('data', data => stream.push(data))
    res.on('end', () => stream.push(null))
  }, uhoh)

  function uhoh(err) {
    // Ignore errors after abort()
    req.aborted || stream.emit('error', err)
  }

  return stream.on('end', () => {
    const { res } = req
    if (!res || res.readable) {
      req.abort() // The user destroyed the stream.
    }
  })
}

quest.ok = function(req, e) {
  const err = e || new Error()
  return new Promise((resolve, reject) => {
    const onError = e => {
      req.destroy()
      err.code = e.code
      def(err, 'name', e.name)
      def(err, 'message', e.message)
      reject(err)
    }
    req.on('error', onError)
    req.on('response', async res => {
      let status = res.statusCode
      switch (String(status).charAt(0)) {
        case '4':
        case '5':
          let msg = res.headers['error'] || res.headers['x-error']
          if (!msg) {
            try {
              // Look in the response body for an error message.
              let json = await readJson(res)
              if ((msg = json.error)) {
                status = json.code || status
              }
            } catch (e) {}
          }
          err.code = status
          err.message = msg || status + ' ' + http.STATUS_CODES[status]
          reject(err)
          break

        case '3':
          // Handle redirections
          if (status == 301 || status == 302) {
            let location = res.headers['location']
            if (location[0] == '/') {
              location =
                req.agent.protocol + '//' + req.getHeader('host') + location
            }
            // TODO: Bail after 4 redirections.
            req = quest(req.method, location, req.getHeaders())
            quest.ok(req, err).then(resolve, reject)
            break
          }

        default:
          resolve(res)
      }
    })
    req.end()
  })
}

quest.send = function(req, body) {
  if (body) {
    if (!Buffer.isBuffer(body)) {
      if (body.constructor == Object) {
        req.setHeader('Content-Type', 'application/json')
        req.setHeader('Content-Encoding', 'gzip')
        body = JSON.stringify(body)
      }
      if (typeof body == 'string') {
        body = Buffer.from(body)
      }
    }
    req.setHeader('Content-Length', Buffer.byteLength(body))
    req.write(body)
  }
  return req
}

quest.read = function(res) {
  if (res instanceof http.ClientRequest) {
    res = quest.stream(res)
  }
  return new Promise((resolve, reject) => {
    concat(res.on('error', reject), resolve)
  })
}

quest.fetch = function(url, headers) {
  return quest.read(quest.stream(url, headers))
}

quest.json = function(url, headers) {
  const res = url.readable ? url : quest.stream(url, headers)
  return new Promise((resolve, reject) => {
    readJson(res).then(resolve, reject)
  })
}

function readJson(res) {
  return new Promise((resolve, reject) => {
    res.on('error', reject)
    concat(res, body => {
      if (!body.length) {
        return resolve(null)
      }
      try {
        resolve(JSON.parse(body.toString()))
      } catch (e) {
        const error = res.error || new Error()
        def(error, 'body', body)
        def(error, 'message', e.message)
        reject(error)
      }
    })
  })
}

// Buffer the entire stream into memory.
function concat(res, done) {
  const chunks = []
  res
    .on('data', chunk => {
      chunks.push(chunk)
    })
    .on('end', () => {
      done(Buffer.concat(chunks))
    })
}

function prepareHeaders(headers) {
  if (!headers) return
  for (let name in headers) {
    let value = headers[name]
    if (value == null) {
      delete headers[name]
    } else if (Array.isArray(value)) {
      headers[name] = value.join(',')
    } else if (typeof value != 'string') {
      headers[name] = String(value)
    }
  }
}

const sockProto = {
  request(method, path, headers) {
    if (http.METHODS.indexOf(method) < 0) {
      throw Error('Unknown HTTP method: ' + method)
    }
    prepareHeaders(headers)
    return http.request({
      socketPath: this.path,
      headers,
      method,
      path,
    })
  },
  stream: bind('stream'),
  fetch: bind('fetch'),
  json: bind('json'),
}

function bind(method) {
  return function() {
    return quest[method](this.request('GET', ...arguments))
  }
}

const requestProto = http.ClientRequest.prototype
quest.augmentRequest = function(request) {
  if (!(request instanceof requestProto)) {
    throw Error('Expected a ClientRequest object')
  }
  Object.assign(requestProto, {
    ok() {
      return quest.ok(this)
    },
    then(next, onError) {
      return this.end().then(done, onError)
    },
    catch(onError) {
      return this.end().catch(onError)
    },
  })
}
