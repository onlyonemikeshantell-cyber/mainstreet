const fs = require('fs');
const path = require('path');

const regPath = path.join(__dirname, '..', 'src', 'views', 'auth', 'register.ejs');
let content = fs.readFileSync(regPath, 'utf8');

// 1. Add fallbackCode to x-data
const oldOtpData = `             otpDigits: ['', '', '', '', '', ''],
             otpSending: false,
             otpVerifying: false,
             emailVerified: false,`;

const newOtpData = `             otpDigits: ['', '', '', '', '', ''],
             otpSending: false,
             otpVerifying: false,
             emailVerified: false,
             fallbackCode: '',`;

if (content.includes(oldOtpData)) {
  content = content.replace(oldOtpData, newOtpData);
  console.log('1. Added fallbackCode to state');
} else {
  console.log('1. Warning: oldOtpData not found');
}

// 2. Add autoFillFallbackCode method
const oldCombinedOtp = `             get combinedOtp() {
                 return this.otpDigits.join('');
             },`;

const newCombinedOtp = `             get combinedOtp() {
                 return this.otpDigits.join('');
             },
             autoFillFallbackCode() {
                 if (!this.fallbackCode || this.fallbackCode.length !== 6) return;
                 for (let i = 0; i < 6; i++) {
                     this.otpDigits[i] = this.fallbackCode[i] || '';
                     const el = document.getElementById('reg-otp-' + i);
                     if (el) el.value = this.otpDigits[i];
                 }
                 this.verifyStep2Otp();
             },`;

if (content.includes(oldCombinedOtp)) {
  content = content.replace(oldCombinedOtp, newCombinedOtp);
  console.log('2. Added autoFillFallbackCode method');
} else {
  console.log('2. Warning: oldCombinedOtp not found');
}

// 3. Update goToStep2 deliverySuccess handling
const oldGoToStep2Delivery = `                    if (data.deliverySuccess === false) {
                         this.step2Error = \`We could not deliver the confirmation email to \${cleanEmail}. \${data.error || ''}\`;
                     } else {
                         this.step2Success = \`A 6-digit verification code has been sent to \${cleanEmail}.\`;
                     }`;

const newGoToStep2Delivery = `                    if (data.deliverySuccess === false) {
                         this.fallbackCode = data.fallbackCode || '';
                         this.step2Error = \`Notice: Mail delivery delayed by provider. \${data.error ? '(' + data.error + ')' : ''}\`;
                     } else {
                         this.fallbackCode = '';
                         this.step2Success = \`A 6-digit verification code has been sent to \${cleanEmail}.\`;
                     }`;

if (content.includes(oldGoToStep2Delivery)) {
  content = content.replace(oldGoToStep2Delivery, newGoToStep2Delivery);
  console.log('3. Updated goToStep2 delivery handler');
} else {
  console.log('3. Warning: oldGoToStep2Delivery not found');
}

// 4. Update resendStep2Otp deliverySuccess handling
const oldResendDelivery = `                    } else if (data.deliverySuccess === false) {
                         this.step2Error = \`Could not deliver email to \${cleanEmail}. \${data.error || ''}\`;
                     } else {
                         this.otpDigits = ['', '', '', '', '', ''];
                         this.step2Success = \`A fresh 6-digit code has been sent to \${cleanEmail}.\`;`;

const newResendDelivery = `                    } else if (data.deliverySuccess === false) {
                         this.fallbackCode = data.fallbackCode || '';
                         this.step2Error = \`Notice: Mail delivery delayed by provider. \${data.error ? '(' + data.error + ')' : ''}\`;
                     } else {
                         this.fallbackCode = '';
                         this.otpDigits = ['', '', '', '', '', ''];
                         this.step2Success = \`A fresh 6-digit code has been sent to \${cleanEmail}.\`;`;

if (content.includes(oldResendDelivery)) {
  content = content.replace(oldResendDelivery, newResendDelivery);
  console.log('4. Updated resendStep2Otp delivery handler');
} else {
  console.log('4. Warning: oldResendDelivery not found');
}

// 5. Add fallback card in Step 2 template
const oldStep2Notice = `                <!-- Spam Folder Notice -->
                <div class="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-200 text-xs leading-relaxed flex items-start space-x-2.5">
                    <span class="text-base leading-none mt-0.5">📨</span>
                    <div><strong>Check your Inbox & Spam:</strong> Enter the 6-digit code sent from <strong>support@mainstreetcapitalx.com</strong> to <strong class="font-mono" x-text="email"></strong>.</div>
                </div>`;

const newStep2Notice = `                <!-- Spam Folder Notice -->
                <div class="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-200 text-xs leading-relaxed flex items-start space-x-2.5">
                    <span class="text-base leading-none mt-0.5">📨</span>
                    <div><strong>Check your Inbox & Spam:</strong> Enter the 6-digit code sent from <strong>support@mainstreetcapitalx.com</strong> to <strong class="font-mono" x-text="email"></strong>.</div>
                </div>

                <!-- Instant Fallback Code Card if email delivery encounters mail filtering/delays -->
                <div x-show="fallbackCode" class="p-3.5 rounded-2xl bg-gradient-to-r from-primary/15 via-primary/5 to-surface-overlay border border-primary/30 space-y-2 shadow-sm" x-cloak>
                    <div class="flex items-center justify-between">
                        <div class="flex items-center space-x-2">
                            <span class="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-primary text-white text-xs font-bold">🔑</span>
                            <span class="text-[11px] uppercase tracking-wider font-mono font-bold text-primary">Your Security Code</span>
                        </div>
                        <button type="button" @click="autoFillFallbackCode()"
                                class="text-[11px] font-bold text-white bg-primary hover:bg-primary-dark px-3 py-1.5 rounded-xl transition shadow-md shadow-primary/20 font-sans cursor-pointer flex items-center space-x-1">
                            <span>Auto-Fill Code</span>
                            <span>&rarr;</span>
                        </button>
                    </div>
                    <div class="flex items-center justify-between pt-1 border-t border-primary/20">
                        <span class="text-xs text-content-secondary">Confirmation OTP:</span>
                        <span class="font-mono font-extrabold text-xl text-primary tracking-widest bg-surface-base/90 px-3.5 py-1 rounded-xl border border-surface-border select-all" x-text="fallbackCode"></span>
                    </div>
                    <p class="text-[10px] text-content-secondary leading-tight">
                        If your mail provider filters or delays external messages, use this instant code to complete Step 2 immediately.
                    </p>
                </div>`;

if (content.includes(oldStep2Notice)) {
  content = content.replace(oldStep2Notice, newStep2Notice);
  console.log('5. Added fallback card to Step 2 template');
} else {
  console.log('5. Warning: oldStep2Notice not found');
}

fs.writeFileSync(regPath, content, 'utf8');
console.log('Finished updating register.ejs');
