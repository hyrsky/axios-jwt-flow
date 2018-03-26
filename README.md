# axios-jwt-flow

Inspired by python library [requests-oauthlib](https://github.com/requests/requests-oauthlib).

The OAuth 2.0 JWT bearer token flow defines how a JWT can be used to request an
OAuth access token when a client wants to use a previous authorization.
Authentication of the authorized app is provided by a digital signature
applied to the JWT.

This library uses axios to build http rest client that supports fetching
oauth2.0 access tokens using JWT Bearer Token Flow and automatically insert 
authorization header to requests.

This library is designed to work with my custom Salesforce apex rest endpoint and will most
likely not work with anything else. Relevant salesforce documentation can be found
[here](https://help.salesforce.com/articleView?id=remoteaccess_oauth_jwt_flow.htm).

Relevant ietf rfc: https://tools.ietf.org/html/rfc7523

## Install instructions ##

1. Generate RSA key with command:  
`openssl req -newkey rsa:2048 -nodes -keyout key.pem -x509 -days 365 -out certificate.pem`

```
yarn add git+https://git@github.com/hyrsky/axios-jwt-flow.git
```

## Testing ##

```
yarn test
yarn coverage
```

## Example app ##

```js
const {Client} = require('axios-jwt-flow');
const fs = require('fs');
const path = require('path');

const tokenFile = path.join(__dirname, process.env.SALESFORCE_TOKEN_FILE || 'token.json');

const writeToken = (token) => new Promise((resolve, reject) => {
    fs.writeFile(tokenFile, JSON.stringify(token), 'utf8', err => {
        if (err) return reject(err);
        return resolve();
    });
});

const readToken = (path) => new Promise((resolve, reject) => {
    fs.readFile(path, (err, data) => {
        if (err) return reject(err);
        return resolve(JSON.parse(data));
    });
});

var client = new Client({
    payload: {
        aud: process.env.SALESFORCE_ENDPOINT || 'https://test.salesforce.com',
        iss: process.env.SALESFORCE_CONSUMER_KEY,
        sub: process.env.SALESFORCE_USERNAME,
    },
    privateKey: fs.readFileSync(path.join(__dirname, 'key.pem')),
    tokenHost: process.env.SALESFORCE_ENDPOINT || 'https://test.salesforce.com',
    tokenPath: '/services/oauth2/token',
    autoRefresh: true,
    onRefresh: writeToken
});

readToken(tokenFile)
    .then(client.setToken) // Use cached token
    .catch(err => {
        // Fetch new token and write it to file.
        return client.fetchToken().then(writeToken);
    })
    .then(() => return client.instance.get('/services/apexrest/my-endpoint'))
    .then(console.log)
    .catch(console.log);
```

