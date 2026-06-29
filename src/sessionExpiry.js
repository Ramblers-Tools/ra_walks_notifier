const { sendEmail } = require('./email');

function isLoginPage(url, text) {
  const pageText = String(text || '');
  return !/walks-manager\.ramblers\.org\.uk\/walks-manager\//.test(String(url || ''))
    || /sign in|single sign-on|single sign on|password|verify your identity|Microsoft|Ramblers account/i.test(pageText);
}

async function sendSessionExpiredEmail() {
  const text = [
    'Walks Manager Watch could not access the Walks Manager review list.',
    '',
    'The saved Ramblers single sign-on session has probably expired.',
    '',
    'Open Walks Manager Watch, choose Login to Walks Manager, and sign in again.'
  ].join('\n');
  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17212b;">
        <div style="max-width:640px;margin:0 auto;padding:24px;">
          <div style="background:#ffffff;border:1px solid #d8dee8;border-radius:8px;overflow:hidden;">
            <div style="padding:20px 24px;background:#7c2d12;color:#ffffff;">
              <img src="cid:walks-manager-watch-logo" width="140" alt="Ramblers" style="display:block;max-width:140px;height:auto;">
              <h1 style="margin:16px 0 0;font-size:22px;line-height:1.25;">Walks Manager login required</h1>
            </div>
            <div style="padding:20px 24px;font-size:16px;line-height:1.5;">
              <p>Walks Manager Watch could not access the Walks Manager review list.</p>
              <p>The saved Ramblers single sign-on session has probably expired.</p>
              <p>Open <strong>Walks Manager Watch</strong>, choose <strong>Login to Walks Manager</strong>, and sign in again.</p>
            </div>
          </div>
        </div>
      </body>
    </html>`;

  await sendEmail('Walks Manager Watch: login required', text, html);
}

module.exports = { isLoginPage, sendSessionExpiredEmail };
