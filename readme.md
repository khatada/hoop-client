- HTTP request tunnel, like [ngrok](https://ngrok.com/)
    - server: [hoop](https://github.com/khatada/hoop)
    - client: [this repository](https://github.com/khatada/hoop-client)

## Install & Run

- install
```
git clone git@github.com:khatada/hoop-client.git
cd hoop-client
npm install
npm run build
```

- run

```
# If there is a proxy between the hoop-server and the client, set HTTPS_PROXY environment variable. 
export HTTPS_PROXY=http://******

# Start hoop-client
# (HTTP requests to [hostname of hoop-server]/hoop/channel-name/* is tunneled to localhost:3000)
# (auth_token is set by hoop-server)
node index.js -s wss://[hostname of hoop-server]/ -c channel-name -t http://localhost:3000/ -a auth_token
```

## Usage

```
  -V, --version          output the version number
  -c, --channel [value]  channel
  -t, --target [value]   target host to which request are piped
  -s, --server [value]   hoop server url (starts with ws[s]://)
  -a, --auth [value]     authentication token for the server
  -h, --help             output usage information
```