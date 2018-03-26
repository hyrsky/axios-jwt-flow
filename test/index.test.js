const {Client, TokenExpired, InvalidGrant} = require('..');
const fs = require('fs');
const nock = require('nock');
const expect = require("chai").expect;

const token = require('./token.json');
const privKey = fs.readFileSync('key.pem');
const oauthHost = 'https://test.salesforce.com';
const oauthPath = '/services/oauth2/token';
const apiPath = '/services/apexrest/myservice';

describe('Test OAuth flow', () => {
    beforeEach(() => {
        nock(oauthHost).post(oauthPath).reply(200, token);
    });

    describe('Test fetchToken()', () => {
        beforeEach(() => {
            this.client = new Client({
                payload: { iss: '0123456789' },
                privateKey: privKey,
                tokenHost: oauthHost,
                tokenPath: oauthPath,
            });
        });

        it('should return promise', async () => {
            const result = this.client.fetchToken();

            // 3 slightly different ways of verifying a promise
            expect(typeof result.then).to.equal('function');
            expect(result instanceof Promise).to.be.true;
            expect(result).to.equal(Promise.resolve(result));

            return result;
        });

        it('should call oauth endpoint', async () => {
            const result = await this.client.fetchToken();
            expect(nock.pendingMocks()).to.be.an('array').that.is.empty;
        });

        it('should resolve token', async () => {
            const result = await this.client.fetchToken();
            expect(result).to.deep.include(token);
        })

        it('should have expiration date', async () => {
            const result = await this.client.fetchToken();
            expect(result).to.have.property('expires_at');
        })
    });
});

describe("Test API client", () => {
    beforeEach(() => {
        nock(token.instance_url)
            .matchHeader('Authorization', `${token.token_type} ${token.access_token}`)
            .get(apiPath)
            .reply(200, 'Hello world');
    });

    afterEach(() => {
        nock.cleanAll();
        nock.enableNetConnect();
    });

    describe('Test outgoing requests', () => {
        it('should have authorization header', async () => {
            const client = new Client({token: token});
            return client.instance.get(apiPath);
        });

        it('should throw an error when trying to use expired token', async () => {
            const expiredToken = {...token, access_token: 'expired', expires_at: 946684800};
            const client = new Client({token: expiredToken});

            try {
                await client.instance.get(apiPath);

                expect(true).to.equal(false, 'Expected function to throw an error');
            } catch (err) {
                expect(err).to.be.an.instanceof(TokenExpired);
            }

            // Did not call api endpoint
            expect(nock.pendingMocks()).to.be.an('array').that.is.not.empty;
        });
    });

    describe('Test automatic token fetching', () => {
        beforeEach(() => {
            this.expiredToken = {...token, access_token: 'expired', expires_at: 946684800};
            this.client = new Client({
                payload: { iss: '0123456789' },
                privateKey: privKey,
                tokenHost: oauthHost,
                tokenPath: oauthPath,
                token: this.expiredToken,
                autoRefresh: true,
                onRefresh: (token) => {},
            });
        })

        it('should automatically fetch token', async () => {
            // First client should get new token and only then call the api
            nock(oauthHost)
                .post(oauthPath)
                    .reply(200, token);

            const result = await this.client.instance.get(apiPath);

            expect(nock.pendingMocks()).to.be.an('array').that.is.empty;
        });

        it('should only fetch token once given multiple requests', async () => {
            // Expect only one oauth request. Add hefty delay to make sure two
            // api requests are fired before refresh completes.
            nock(oauthHost)
                .post(oauthPath)
                    .delay(250)
                    .reply(200, token);

            // And two api requests (another declared in beforeEach())
            nock(token.instance_url).get(apiPath).reply(200, 'Hello world');

            const promise1 = this.client.instance.get(apiPath);
            const promise2 = this.client.instance.get(apiPath);

            const result = await Promise.all([promise1, promise2]);

            expect(nock.pendingMocks()).to.be.an('array').that.is.empty;
        });
    });
});
