const { sendEmail } = require('../src/services/mailer');

async function testEmail() {
  console.log('Testing sendEmail...');
  try {
    const res = await sendEmail({
      to: 'support@mainstreetcapitalx.com',
      subject: 'Test Email Diagnostic',
      message: 'This is a test OTP diagnostic message'
    });
    console.log('Result:', res);
  } catch (err) {
    console.error('sendEmail threw error:', err);
  }
}

testEmail();
