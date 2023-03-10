import { role, url, expectedRoleLastPageLocation } from '../common/index.js';

fixture `Fixture`
    .page(url)
    .beforeEach( async t => {
        await t.useRole(role);
    });

test('test', async t => {
    await t.expect(role.lastPageLocation).eql(expectedRoleLastPageLocation);
});
