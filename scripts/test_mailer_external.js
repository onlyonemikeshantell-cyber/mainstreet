const { sendEmail } = require('../src/services/mailer');

async function testExternal() {
  console.log('Testing sendEmail to external address...');
  try {
    const res = await sendEmail({
      to: 'onlyonemikeshantell@gmail.com',
      subject: 'Test External Diagnostic',
      message: 'This is a test OTP diagnostic message to Gmail'
    });
    console.log('Result:', res);
  } catch (err) {
    console.error('sendEmail threw error:', err);
  }
}

testExternal();
