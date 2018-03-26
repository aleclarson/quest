const {PassThrough} = require('stream')
const https = require('https')
const http = require('http')

const urlRE = /(.+):\/\/([^\/\:]+)(?:\:([^\/]+))?(.*)/
const protocols = {http, https}

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
  const thru = new PassThrough()

  let req
  if (url instanceof http.ClientRequest) {
    req = url
  } else {
    req = quest('GET', url, headers)
    err.url = url
    err.headers = headers
  }

  req.on('response', (res) => {
    thru.status = res.statusCode
    thru.headers = res.headers
  })

  quest.ok(req, err).then(res => {
    res.pipe(thru)
  }, (err) => {
    thru.emit('error', err)
  })

  return thru
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
    req.on('response', (res) => {
      const status = res.statusCode
      if (status >= 200 && status < 300) {
        res.on('error', onError)
        resolve(res)
      } else {
        err.code = status
        err.message =
          res.headers['error'] ||
          res.headers['x-error'] ||
          status + ' ' + http.STATUS_CODES[status]
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
  return quest.stream(req)
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

const sockProto = {
  request(method, path, headers) {
    if (http.METHODS.indexOf(method) < 0) {
      throw Error('Unknown HTTP method: ' + method)
    }
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
