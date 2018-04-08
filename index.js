const {Readable} = require('stream')
const https = require('https')
const http = require('http')

const urlRE = /(.+):\/\/([^\/\:]+)(?:\:([^\/]+))?(.*)/
const protocols = {http, https}
const noop = Function.prototype

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
  const res = new Readable({
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

  req.on('response', (stream) => {
    let status = stream.statusCode
    res.ok = status >= 200 && status < 300
    res.status = status
    res.headers = stream.headers
    res.emit('response')
  })

  quest.ok(req, err).then(stream => {
    stream.on('data', (chunk) => res.push(chunk))
    stream.on('end', () => res.push(null))
    res.on('end', () => stream.destroy())
  }, (err) => res.emit('error', err))

  return res
}

quest.ok = function(req, e) {
  const err = e || new Error()
  return new Promise((resolve, reject) => {
    const onError = (e) => {
      req.destroy()
      err.code = e.code
      err.message = e.message
      reject(err)
    }
    req.on('error', onError)
    req.on('response', async (res) => {
      let status = res.statusCode
      if (status >= 200 && status < 300) {
        res.on('error', onError)
        resolve(res)
      } else {
        let msg = res.headers['error'] || res.headers['x-error']
        if (!msg) {
          try {
            // Look in the response body for an error message.
            let json = await readJson(res)
            if (msg = json.error) {
              status = json.code || status
            }
          } catch(e) {}
        }
        err.code = status
        err.message = msg || status + ' ' + http.STATUS_CODES[status]
        reject(err)
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
    res.on('error', reject)
    readJson(res).then(resolve, reject)
  })
}

function readJson(res) {
  return new Promise((resolve, reject) => {
    concat(res, (body) => {
      if (!body.length) {
        return resolve(null)
      }
      try {
        resolve(JSON.parse(body.toString()))
      } catch(e) {
        const {error} = res
        error.body = body
        error.message = e.message
        reject(error)
      }
    })
  })
}

// Buffer the entire stream into memory.
function concat(res, done) {
  const chunks = []
  res.on('data', (chunk) => {
    chunks.push(chunk)
  }).on('end', () => {
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
