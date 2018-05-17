
# quest v0.8.1

Bare bones HTTP requests for browser and server.

### `quest(method, url, headers)`

Send any request, and return the request stream immediately.

```js
const req = quest('POST', 'http://your-api.com/users/1')
req.on('response', (res) => {
  if (res.statusCode != 201) {
    console.warn('Failed to create user!')
  }
})
req.write(JSON.stringify({id: 'aleclarson', age: 23}))
req.end()
```

### `quest.stream(url, headers)`

Send a `GET` request, and return the response stream immediately.

```js
const res = quest.stream('https://stream.twitter.com/1.1')
res.on('data', console.log)
res.on('error', (error) => {
  error.args // => ['https://stream.twitter.com/1.1']
  error.req // => The request stream
  error.res // => The response stream
})
```

### `quest.fetch(url, headers)`

Send a `GET` request, then buffer the entire response into memory.

```js
const buffer = await quest.fetch('https://loripsum.net/api')
Buffer.isBuffer(buffer) // => true
```

### `quest.json(url, headers)`

Send a `GET` request, then parse the response as JSON.

```js
const json = await quest.json('https://your-api.com')
if (json == null) {
  console.log('The response was empty')
}
```

## Tips and tricks

In NodeJS, the `stream`, `fetch`, and `json` functions all accept a `ClientRequest` object (the same object type that `quest()` returns). This means you can easily avoid lots of boilerplate code for non-GET requests.

```js
const req = quest('PUT', 'https://localhost:8000', headers)
req.write(json)

// Convert the ClientRequest into a response object.
quest.stream(req)
  .on('data', (data) => {})
  .on('error', (err) => {})

// Convert the ClientRequest into a Buffer promise.
quest.fetch(req).then(buffer => {})

// Convert the ClientRequest into a JSON promise.
quest.json(req).then(data => {})
```

## Caveats

- The `stream` function can only be used in NodeJS (for now)
- The request object returned by `quest()` cannot be passed
  to the other functions in the web version (yet)

