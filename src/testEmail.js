const { sendEmail } = require('./email');
(async () => {
  await sendEmail('Walks Manager Watch test email', 'This is a test email from Walks Manager Watch.');
  console.log('Test email sent.');
})();
