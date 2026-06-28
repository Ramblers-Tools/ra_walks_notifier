const nodemailer = require('nodemailer');
const { smtp, validateEmailConfig } = require('./config');

async function sendEmail(subject, text, html) {
  validateEmailConfig();
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass }
  });
  await transporter.sendMail({
    from: smtp.from,
    to: smtp.to,
    subject,
    text,
    html
  });
}

module.exports = { sendEmail };
