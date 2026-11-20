const fs = require('fs');
const path = require('path');

// 1. Update src/views/public/retirement.ejs
const retPath = path.join(__dirname, '../src/views/public/retirement.ejs');
let retContent = fs.readFileSync(retPath, 'utf8');

// A. Clean retirementApp() in retirement.ejs
const calcPropsRegex = /\s*currentAge:\s*32,[\s\S]*?expectedReturnRate:\s*9\.5,\s*\/\/\s*Annual\s*% ROI/g;
retContent = retContent.replace(calcPropsRegex, '');

const calcGettersRegex = /\s*get yearsToRetire\(\)[\s\S]*?get estimatedMonthlyRetirementIncome\(\)[\s\S]*?return Math\.round\(\(this\.projectedNestEgg \* 0\.04\) \/ 12\);\s*},/g;
retContent = retContent.replace(calcGettersRegex, '');

// B. Update hero button
retContent = retContent.replace(
  /<a href="#nest-egg-calc"[\s\S]*?📈 Interactive Nest-Egg Calculator[\s\S]*?<\/a>/,
  `<a href="#ira-plans" class="px-7 py-3.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] text-[#1d1d1f] dark:text-[#f5f5f7] font-medium text-sm border border-black/[0.08] dark:border-white/[0.1] transition active:scale-[0.98]">
                    Explore IRA Options &rarr;
                </a>`
);

// C. Add id="ira-plans" to Section 2
retContent = retContent.replace(
  /<section class="py-24 bg-white dark:bg-\[#161617\] border-b border-black\/\[0\.06\] dark:border-white\/\[0\.08\] transition-colors duration-200">/,
  `<section id="ira-plans" class="py-24 bg-white dark:bg-[#161617] border-b border-black/[0.06] dark:border-white/[0.08] transition-colors duration-200">`
);

// D. Remove the entire Section 3 Calculator
const section3Regex = /<!-- =+ -->\s*<!-- 3\. INTERACTIVE RETIREMENT NEST-EGG COMPOUND CALCULATOR[\s\S]*?<\/section>/;
if (section3Regex.test(retContent)) {
  retContent = retContent.replace(section3Regex, '');
  console.log('✓ Successfully removed Retirement Trajectory Calculator section from retirement.ejs');
} else {
  console.error('Section 3 regex did not match in retirement.ejs');
}

fs.writeFileSync(retPath, retContent, 'utf8');
console.log('✓ Updated retirement.ejs');

// 2. Update src/views/public/home.ejs
const homePath = path.join(__dirname, '../src/views/public/home.ejs');
let homeContent = fs.readFileSync(homePath, 'utf8');

homeContent = homeContent.replace(
  /\/retirement#nest-egg-calc/g,
  '/retirement#ira-plans'
);

homeContent = homeContent.replace(
  /<span>Simulate Your Compound Nest Egg<\/span>/g,
  '<span>Explore Tax-Advantaged Retirement Plans</span>'
);

fs.writeFileSync(homePath, homeContent, 'utf8');
console.log('✓ Updated home.ejs');
