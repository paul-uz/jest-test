import { handler } from '../index';

test('IP is not allowed', async () => {
  const isIpAllowed = handler.isIpAllowed('127.0.0.1');
  expect(isIpAllowed).toEqual(false);
});

test('IP is allowed', async () => {
  const isIpAllowed = handler.isIpAllowed('54.187.216.72');
  expect(isIpAllowed).toEqual(true);
});
