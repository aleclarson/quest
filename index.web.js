// TODO: Add response streaming

var setProto = Object.setPrototypeOf

function quest(method, url, headers) {
  var req = Object.create(Request)
  req.method = method
  req.url = url
  return Object.defineProperty(req, '_xhr', {
    value: open(method, url, headers)
  })
}

quest.stream = function() {
  // https://gist.github.com/igrigorik/5736866
  throw Error('Unimplemented')
}

quest.fetch = function(url, headers) {
  return new Promise(function(resolve, reject) {
    var xhr = open('GET', url, headers)
    onLoad(resolve, xhr)
    onError(reject, xhr)
    xhr.send()
  })
}

quest.json = function(url, headers) {
  return quest.fetch(url, headers).then(parseJson)
}

module.exports = quest

//
// Internal
//

var Request = {
  on: function(event, listener) {
    if (event == 'error') {
      onError(listener, this._xhr)
    } else if (event == 'load') {
      onLoad(listener, this._xhr)
    } else {
      this._xhr['on' + event] = listener
    }
    return this
  },
  write: function(chunk) {
    if (this._blob) this._blob = [chunk]
    else this._blob.push(chunk)
    return this
  },
  end: function() {
    if (this._sent) {
      throw Error('Request already sent')
    }
    this._sent = true
    if (!this._xhr.onerror) {
      onError(console.error, this._xhr)
    }
    this._xhr.send(this._blob ? new Blob(this._blob) : null)
    return this
  },
  send: function(body) {
    if (body) this.write(body)
    return this.end()
  }
}

function open(method, url, headers) {
  var xhr = new XMLHttpRequest()
  xhr.open(method, url)
  if (headers) {
    for (var key in headers) {
      xhr.setRequestHeader(key.toLowerCase(), headers[key])
    }
  }
  return Object.defineProperty(xhr, 'headers', {
    get: parseHeaders,
  })
}

function onLoad(listener, xhr) {
  xhr.onload = function() {
    if (xhr.status >= 300) {
      try {
        var err = new Error(xhr.responseText)
      } catch(e) {
        err = new Error('Expected response to have 2xx status, instead got ' + xhr.status)
      }
      err.status = xhr.status
      Object.defineProperty(err, 'headers', {
        get: function() {return xhr.headers}
      })
      if (xhr.onerror) {
        xhr.onerror(err)
      } else {
        console.error(err)
      }
    } else {
      listener('response' in xhr ? xhr.response : xhr.responseText)
    }
  }
}

function onError(listener, xhr) {
  xhr.onerror = xhr.ontimeout = function(err) {
    if (!err) {
      err = new Error('Request timed out')
      err.status = 522
    }
    listener(err)
  }
}

function parseHeaders() {
  var parsed = {}
  var headers = this.getAllResponseHeaders()
  if (headers) {
    headers.replace(/\r?\n[\t ]+/g, ' ')
    .split(/\r?\n/).forEach(function(line) {
      var splitIdx = line.indexOf(':')
      if (splitIdx >= 0) {
        var key = line.slice(0, splitIdx).trim()
        headers[key] = line.slice(splitIdx).trim()
      }
    })
  }
  return parsed
}

function parseJson(res) {
  return typeof res == 'string' ? JSON.parse(res) : JSON.parse(res.toString())
}
