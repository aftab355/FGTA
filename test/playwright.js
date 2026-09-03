/* Playwright is not a dependency of this project — the site has no build step
   and no node_modules — so the video tests borrow whichever copy is on the
   machine and say so plainly when there isn't one. */
const {execSync}=require('child_process');
let mod=null;
for(const how of [
  ()=>require('playwright'),
  ()=>require(execSync('npm root -g',{encoding:'utf8'}).trim()+'/playwright')
]){ try{ mod=how(); break; }catch(e){} }
if(!mod){
  console.error('These tests need playwright and a chromium build.\n'+
                '  npm i -g playwright && npx playwright install chromium\n'+
                'The logic tests (node test/vision-core.test.js) need neither.');
  process.exit(2);
}
module.exports=mod;
