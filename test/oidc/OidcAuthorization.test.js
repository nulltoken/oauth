import { assert } from '@open-wc/testing';
import { handleTokenInfo, rejectFunction, resolveFunction, settingsValue, stateValue } from '../../src/OAuth2Authorization.js';
import { OidcAuthorization } from '../../src/OidcAuthorization.js';
import env from '../env.js';

/** @typedef {import('../../src/types').OpenIdProviderMetadata} OpenIdProviderMetadata */
/** @typedef {import('@advanced-rest-client/events').Authorization.OidcTokenInfo} OidcTokenInfo */

describe('OidcAuthorization', () => {
  const oauth2redirect = `${window.location.origin}/oauth-popup.html`;
  const fullDiscoveryUrl = `${env.oauth2.issuer}/.well-known/openid-configuration`;

  describe('Unit tests', () => {
    describe('buildPopupUrlParams()', () => {
      it('add nonce parameter when id_token', async () => {
        const instance = new OidcAuthorization({
          responseType: 'code id_token',
          authorizationUri: 'https://api.domain.com',
        });
        const result = await instance.buildPopupUrlParams();
        assert.typeOf(result.searchParams.get('nonce'), 'string');
      });

      it('ignores nonce when other parameter', async () => {
        const instance = new OidcAuthorization({
          responseType: 'code',
          authorizationUri: 'https://api.domain.com',
        });
        const result = await instance.buildPopupUrlParams();
        assert.isFalse(result.searchParams.has('nonce'));
      });
    });

    describe('validateTokenResponse()', () => {
      it('returns true when has id_token', async () => {
        const instance = new OidcAuthorization({});
        const params = new URLSearchParams();
        params.set('id_token', '1234567');
        const result = instance.validateTokenResponse(params);
        assert.isTrue(result);
      });

      it('returns true for parent conditions', async () => {
        const instance = new OidcAuthorization({});
        const params = new URLSearchParams();
        params.set('access_token', '1234567');
        const result = instance.validateTokenResponse(params);
        assert.isTrue(result);
      });
    });

    describe('prepareTokens()', () => {
      /** @type OidcAuthorization */
      let instance;
      /** @type URLSearchParams */
      let params;

      beforeEach(() => {
        instance = new OidcAuthorization({
          responseType: 'code token id_token',
          scopes: ['a', 'b'],
        });

        params = new URLSearchParams();
        params.set('token_type', 'Bearer');
        params.set('access_token', 'at-test');
        params.set('code', 'code-test');
        params.set('id_token', 'id-test');
        params.set('refresh_token', 'rt-test');
        params.set('expires_in', '1234');
        params.set('state', 'state-test');
        params.set('scope', 'a c');
      });

      it('returns the list of tokens from the params', () => {
        const result = instance.prepareTokens(params, 123);
        assert.typeOf(result, 'array', 'returns an array');
        assert.lengthOf(result, 3, 'returns a token for each response type');

        const [code, token, id] = result;
        assert.equal(code.state, 'state-test', 'code token has state');
        assert.equal(code.expiresIn, 1234, 'code token has expiresIn');
        assert.equal(code.tokenType, 'Bearer', 'code token has tokenType');
        assert.equal(code.time, 123, 'code token has time');
        assert.equal(code.responseType, 'code', 'code token has responseType');
        assert.equal(code.code, 'code-test', 'code token has code');
        assert.deepEqual(code.scope, ['a', 'c'], 'code token has scope');

        assert.equal(token.state, 'state-test', 'token token has state');
        assert.equal(token.expiresIn, 1234, 'token token has expiresIn');
        assert.equal(token.tokenType, 'Bearer', 'token token has tokenType');
        assert.equal(token.time, 123, 'token token has time');
        assert.equal(token.responseType, 'token', 'token token has responseType');
        assert.equal(token.accessToken, 'at-test', 'token token has accessToken');
        assert.equal(token.refreshToken, 'rt-test', 'token token has refreshToken');
        assert.deepEqual(token.scope, ['a', 'c'], 'token token has scope');

        assert.equal(id.state, 'state-test', 'id token has state');
        assert.equal(id.expiresIn, 1234, 'id token has expiresIn');
        assert.equal(id.tokenType, 'Bearer', 'id token has tokenType');
        assert.equal(id.time, 123, 'id token has time');
        assert.equal(id.responseType, 'id_token', 'id token has responseType');
        assert.equal(id.accessToken, 'at-test', 'id token has accessToken');
        assert.equal(id.refreshToken, 'rt-test', 'id token has refreshToken');
        assert.equal(id.idToken, 'id-test', 'id token has idToken');
        assert.deepEqual(id.scope, ['a', 'c'], 'id token has scope');
      });

      it('uses settings scopes', () => {
        params.delete('scope');
        const result = instance.prepareTokens(params, 123);
        const [code, token, id] = result;
        assert.deepEqual(code.scope, ['a', 'b'], 'code token has scope');
        assert.deepEqual(token.scope, ['a', 'b'], 'token token has scope');
        assert.deepEqual(id.scope, ['a', 'b'], 'id token has scope');
      });

      it('uses response type mapped from grant type', () => {
        const cp = { ...instance.settings };
        delete cp.responseType;
        cp.grantType = 'authorization_code';
        instance[settingsValue] = cp;
        const result = instance.prepareTokens(params, 123);
        
        assert.lengthOf(result, 1, 'has single token');
        const [code] = result;
        assert.equal(code.state, 'state-test', 'code token has state');
        assert.equal(code.expiresIn, 1234, 'code token has expiresIn');
        assert.equal(code.tokenType, 'Bearer', 'code token has tokenType');
        assert.equal(code.time, 123, 'code token has time');
        assert.equal(code.responseType, 'code', 'code token has responseType');
        assert.equal(code.code, 'code-test', 'code token has code');
        assert.deepEqual(code.scope, ['a', 'c'], 'code token has scope');
      });

      it('returns null when no valid settings', () => {
        const cp = { ...instance.settings };
        delete cp.responseType;
        instance[settingsValue] = cp;
        const result = instance.prepareTokens(params, 123);
        
        assert.isNull(result);
      });
    });

    describe('[handleTokenInfo]()', () => {
      /** @type OidcAuthorization */
      let instance;

      beforeEach(() => {
        instance = new OidcAuthorization({
          responseType: 'code',
          scopes: ['a', 'b'],
        });
      });

      it('translates OAuth2 token to OIDC token', async () => {
        const promise = new Promise((resolve) => {
          instance[resolveFunction] = resolve;
        });
        instance[handleTokenInfo]({
          accessToken: 'at-test',
          expiresAt: 9876,
          expiresIn: 1234,
          state: 'state-test',
          scope: ['a', 'b'],
          tokenType: 'Bearer',
        });
        const result = await promise;
        
        assert.isArray(result, 'produces the array');
        const [token] = result;
        assert.equal(token.responseType, 'code', 'has the response type');
        assert.equal(token.state, 'state-test', 'has the state');
        assert.equal(token.accessToken, 'at-test', 'has the accessToken');
        assert.equal(token.tokenType, 'Bearer', 'has the tokenType');
        assert.equal(token.expiresIn, 1234, 'has the expiresIn');
        assert.typeOf(token.time, 'number', 'has the time');
        assert.deepEqual(token.scope, ['a', 'b'], 'has the scope');
      });
    });

    describe('processTokenResponse()', () => {
      it('resolves error when no state', async () => {
        const instance = new OidcAuthorization({
          responseType: 'code',
          scopes: ['a', 'b'],
        });
        const promise = new Promise((resolve, reject) => {
          instance[resolveFunction] = resolve;
          instance[rejectFunction] = reject;
        });
        const params = new URLSearchParams();
        await instance.processTokenResponse(params);
        let error;
        try {
          await promise;
        } catch (e) {
          error = e;
        }
        assert.equal(error.message, 'Server did not return the state parameter.');
        assert.equal(error.code, 'no_state');
      });

      it('resolves error when different state', async () => {
        const instance = new OidcAuthorization({
          responseType: 'code',
          scopes: ['a', 'b'],
        });
        const promise = new Promise((resolve, reject) => {
          instance[resolveFunction] = resolve;
          instance[rejectFunction] = reject;
        });
        const params = new URLSearchParams();
        params.set('state', '1');
        instance[stateValue] = '2';
        await instance.processTokenResponse(params);
        let error;
        try {
          await promise;
        } catch (e) {
          error = e;
        }
        assert.equal(error.message, 'The state value returned by the authorization server is invalid.');
        assert.equal(error.code, 'invalid_state');
      });

      it('resolves error when response error', async () => {
        const instance = new OidcAuthorization({
          responseType: 'code',
          scopes: ['a', 'b'],
        });
        const promise = new Promise((resolve, reject) => {
          instance[resolveFunction] = resolve;
          instance[rejectFunction] = reject;
        });
        const params = new URLSearchParams();
        params.set('state', '1');
        params.set('error', 'error-code');
        params.set('error_description', 'error-desc');
        instance[stateValue] = '1';
        await instance.processTokenResponse(params);
        let error;
        try {
          await promise;
        } catch (e) {
          error = e;
        }
        assert.equal(error.message, 'error-desc');
        assert.equal(error.code, 'error-code');
      });

      it('resolves with a token', async () => {
        const instance = new OidcAuthorization({
          responseType: 'token',
          scopes: ['a', 'b'],
        });
        const promise = new Promise((resolve, reject) => {
          instance[resolveFunction] = resolve;
          instance[rejectFunction] = reject;
        });
        const params = new URLSearchParams();
        params.set('state', '1');
        params.set('access_token', 'at-test');
        params.set('refresh_token', 'rt-test');
        params.set('expires_in', '3599');
        params.set('token_type', 'Bearer');
        params.set('scope', 'a c');
        instance[stateValue] = '1';
        await instance.processTokenResponse(params);
        const result = await promise;
        const [token] = result;
        
        assert.equal(token.state, '1', 'has the state');
        assert.equal(token.expiresIn, 3599, 'has the expiresIn');
        assert.equal(token.tokenType, 'Bearer', 'has the tokenType');
        assert.equal(token.responseType, 'token', 'has the responseType');
        assert.equal(token.accessToken, 'at-test', 'has the accessToken');
        assert.equal(token.refreshToken, 'rt-test', 'has the refreshToken');
        assert.typeOf(token.time, 'number', 'has the time');
        assert.deepEqual(token.scope, ['a', 'c'], 'has the scope');
      });
    });

    /**
     * @returns {Promise<OpenIdProviderMetadata>} 
     */
    async function discovery() {
      const response = await fetch(fullDiscoveryUrl);
      return response.json();
    }

    describe('authorization', () => {
      /** @type OpenIdProviderMetadata */
      let info;

      before(async () => {
        info = await discovery();
      });

      it('requests a code response with authorization_code grant', async () => {
        const instance = new OidcAuthorization({
          grantType: 'authorization_code',
          responseType: 'code',
          authorizationUri: info.authorization_endpoint,
          accessTokenUri: info.token_endpoint,
          scopes: info.response_types_supported,
          redirectUri: oauth2redirect,
          clientId: 'test-cid',
          clientSecret: 'test-cs',
        });
        const result = await instance.authorize();
        assert.lengthOf(result, 1, 'has a single token');

        const token = /** @type OidcTokenInfo */ (result[0]);
        assert.typeOf(token.state, 'string', 'has the state');
        assert.equal(token.expiresIn, 3600, 'has the expiresIn');
        assert.equal(token.tokenType, 'Bearer', 'has the tokenType');
        assert.equal(token.responseType, 'code', 'has the responseType');
        assert.deepEqual(token.scope, [ 'dummy' ], 'has the scope');
        assert.typeOf(token.time, 'number', 'has the time');
        assert.typeOf(token.code, 'string', 'has the code');
        assert.typeOf(token.accessToken, 'string', 'has the accessToken');
        assert.typeOf(token.refreshToken, 'string', 'has the refreshToken');
        assert.typeOf(token.idToken, 'string', 'has the idToken');
      });
      
    });
  });
});
