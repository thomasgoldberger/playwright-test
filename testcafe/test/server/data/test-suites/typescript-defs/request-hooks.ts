/// <reference path="../../../../../ts-defs/index.d.ts" />
import {ClientFunction, RequestLogger, RequestMock, RequestHook} from 'testcafe';

class CustomAsyncRequestHook extends RequestHook {
    constructor() {
        super();
    }

    async onRequest (event: object) {
    }

    async onResponse (event: object) {
    }
}

class CustomSyncRequestHook extends RequestHook {
    constructor() {
        super();
    }

    onRequest (event: object) {
    }

    onResponse (event: object) {
    }
}

const customAsyncHook = new CustomAsyncRequestHook();
const customSyncHook  = new CustomSyncRequestHook();
const logger1         = RequestLogger('example.com', {logRequestBody: true});

const logger2 = RequestLogger(req => {
    return req.url === 'example.com';
});

const mock = RequestMock()
    .onRequestTo(/example.com/)
    .respond()
    .onRequestTo({url: 'https://example.com'})
    .respond(null, 204)
    .onRequestTo('https://example.com')
    .respond(null, 200, {'x-frame-options': 'deny'})
    .onRequestTo(req => {
        return req.url === 'https://example.com';
    }).respond((req, res) => {
        res.headers['Content-type'] = 'application/json';
        if (req.url === 'https://example.com')
            res.statusCode = 200;
    });


fixture `Request Hooks`
    .requestHooks(mock, logger1, logger2, customAsyncHook, customSyncHook);

test
    .requestHooks(logger1)
    ('Request hook', async t => {
        await t
            .addRequestHooks(mock)
            .removeRequestHooks(mock)
            .expect(logger1.contains((t: any) => t.request.statusCode === 200)).ok()
            .expect(logger1.count((t: any) => t.request.statusCode === 200)).eql(1)
            .expect(logger1.requests[0].request.body === 'test').ok()
            .expect(logger1.requests[0].response.timestamp - logger1.requests[0].request.timestamp).gt(0);
    });
