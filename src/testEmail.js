const { sendEmail } = require('./email');
(async () => {
  await sendEmail('Walks Manager Watch test email', 'This is a test email from Walks Manager Watch v3.');
  console.log('Test email sent.');
})();
