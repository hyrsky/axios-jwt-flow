'use strict';

const querystring = require('querystring');
const axios = require('axios');
const jws = require('jws');
const AsyncLock = require('async-lock');
const lock = new AsyncLock();

/**
 * If an error occurs when processing the JWT bearer token, the server replies
 * with a standard OAuth error response with reasons why the token was
 * considered invalid.
 */
class InvalidGrant extends Error {
    constructor(message) {
        super(message);
    }
}

/**
 * Token expired exception.
 */
class TokenExpired extends Error {
    constructor(message) {
        super(message);
    }
}

/**
 * Axios request interceptor - add session token to request
 *
 * Request new token if old is expired and autoRefresh is truthy.
 * Optionally call onRefresh callback after refresh.
 *
 * Library should detect multiple concurrently running
 * functions and not refreshing the token multiple times.
 */
const requestInterceptor = async ({ oauthClient, ...config }) => {
    if (oauthClient.isTokenExpired()) {
        // If autoRefresh is truthy fetch new token.
        if (oauthClient.options.autoRefresh) {
            // Await fetch to complete before continuing.
            let token = await lock.acquire(__dirname + '/' + __filename, () => {
                if (oauthClient.isTokenExpired()) {
                    return oauthClient.fetchToken();
                }
            }, {});

            // Optional consumer callback when new token is fetced.
            token && oauthClient.onRefresh && oauthClient.onRefresh(token);
        } else throw new TokenExpired('Token is expired');
    }

    return {
        ...config,
        baseURL: oauthClient.token.instance_url,
        headers: {
            ...config.headers,
            'Authorization': `${oauthClient.token.token_type} ${oauthClient.token.access_token}`
        },
    }
};

const hasNestedProperty = (obj, ...args) => {
    for (let arg of args) {
        if (typeof obj !== 'object' || !obj.hasOwnProperty(arg)) {
            return false;
        }
        obj = obj[arg];
    }
    return true;
}

/**
 * OAuth 2.0 JWT Bearer Token Flow API client using axios library.
 *
 * @example
 *  let client = new Client({...});
 *
 *  // Get protected url with credentials.
 *  client.instance.get('/protected_url);
 */
class Client {
    constructor ({ token, onRefresh, ...options }) {
        const instanceOptions = { oauthClient: this };
        const instance = axios.create(instanceOptions);

        // Interceptor that includes oauth credentials to every request.
        instance.interceptors.request.use(requestInterceptor);

        this.instance = instance;
        this.setToken(token);

        // Callbacks
        this.onRefresh = onRefresh;

        // Options and default values
        this.options = {
            ...options,

            // By default token expires in 5 minutes.
            expiresIn: options.expiresIn || (60 * 5),

            // Seconds before the real expiration time the jwt token is
            // considered expired. This is to make it less propable the client
            // is going to use expired tokens due to network lag or inperfect 
            // clocks.
            expiryLeeway: options.expiryLeeway || 5,
        };
    }

    /**
     * Set token
     */
    setToken(token) {
        this.token = token || {};
    }

    /**
     * Check if token is expired.
     *
     * @returns {Boolean} True if token is expired.
     */
    isTokenExpired() {
        return ((Math.floor(new Date() / 1000) + this.options.expiryLeeway) >= this.token.expires_at);
    }

    /**
     * Fetch new token from token host.
     *
     * @returns {Promise.<object, Error>} A promise that returns the token if
     *  resolved, or an Error if rejected.
     */
    fetchToken() {
        // Calculate token expiration time from current time.
        const expiresAt = Math.floor(new Date() / 1000) + this.options.expiresIn;

        // Use brand new instance without interceptor.
        return axios.post(this.options.tokenHost + this.options.tokenPath, querystring.stringify({
            'grant_type' : 'urn:ietf:params:oauth:grant-type:jwt-bearer',

            // Construct jwt token.
            'assertion' : jws.sign({
                header: { alg: 'RS256' },
                payload: {
                    ...this.options.payload,

                    // Use calculated expiration date.
                    exp: expiresAt
                },
                privateKey: this.options.privateKey
            })
        })).then(response => {
            const token = response.data;

            // Set signature expiration time to default token expiration time..
            token.expires_at = token.expires_at || expiresAt;

            this.setToken(token);

            return token;
        }).catch(error => {
            if (hasNestedProperty(error, 'response', 'data', 'error') &&
                    error.response.data.error === 'invalid_grant') {
                throw new InvalidGrant(error.response.data.error_description);
            }
            throw error;
        });
    };
}

module.exports.Client = Client;
module.exports.InvalidGrant = InvalidGrant;
module.exports.TokenExpired = TokenExpired;
