const { createFixtureApp } = require('./communication-app');

module.exports = async () => {
  const { app, data } = createFixtureApp();
  await data.store.saveMessage({ classId: 10, parentId: 1, senderId: 2,
    body: 'Welcome! Please bring your workbook to our next class. You can reply here if you have any questions.',
    submissionKey: 'fixture-welcome', recipientIds: [] });
  const server = app.listen(3101, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
};
