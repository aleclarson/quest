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
  const thru = new PassThrough()

  // Capture the stack trace early.
  const err = new Error()
  err.args = [url, headers]
  thru.error = err

  const req = url instanceof http.ClientRequest
    ? url : quest('GET', url, headers)

  req.on('response', (res) => {
    err.req = req
    err.res = res
    const code = res.statusCode
    if (code >= 200 && code < 300) {
      res.pipe(thru)
      res.on('error', (e) => {
        res.destroy()
        err.code = e.code
        err.message = e.message
        thru.emit('error', err)
      })
    } else {
      err.code = code
      err.message = code + ' ' + http.STATUS_CODES[code]
      thru.emit('error', err)
    }
  }).on('error', (e) => {
    req.destroy()
    err.req = req
    err.code = e.code
    err.message = e.message
    thru.emit('error', err)
  })
  req.end()
  return thru
}

quest.fetch = function(url, headers) {
  const res = quest.stream(url, headers)
  return new Promise((resolve, reject) => {
    res.on('error', reject)
    concat(res).on('data', resolve)
  })
}

quest.json = function(url, headers) {
  const res = quest.stream(url, headers)
  return new Promise((resolve, reject) => {
    res.on('error', reject)
    concat(res).on('data', (body) => {
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
function concat(res) {
  const thru = new PassThrough()
  const chunks = []
  res.on('data', (chunk) => {
    chunks.push(chunk)
  }).on('end', () => {
    thru.write(Buffer.concat(chunks))
    thru.end()
  })
  return thru
}

const sockProto = {
  request(method, path, headers) {
    if (http.METHODS.indexOf(method) < 0) {
      throw Error('Unknown HTTP method: ' + method)
    }
    return protocol.request({
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
