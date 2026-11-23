import {createYahooSessionClient} from '../../../yahoo-session-client.mjs';
import {tokenRequest, redirect} from './_lib.js';
import {refreshClaim, finishRefresh, markRefreshUncertain} from './_store.js';

export function yahooSessionClient(owner, {read} = {}) {
  return createYahooSessionClient(owner, {
    store: {claim: refreshClaim, finish: finishRefresh, uncertain: markRefreshUncertain},
    exchange: refreshToken => tokenRequest({grant_type: 'refresh_token', refresh_token: refreshToken, redirect_uri: redirect()}),
    read
  });
}
