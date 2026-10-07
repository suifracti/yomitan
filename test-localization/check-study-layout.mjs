// Fresh, profile-free offline rendering. No installed extension pages or Chrome profile access.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const root=new URL('../ext/',import.meta.url);
const server=createServer((req,res)=>{
 const path=(req.url||'/').split('?')[0];
 try {
  if(path==='/preview') {res.setHeader('Content-Type','text/html');res.end(readFileSync(`/tmp/study-preview-${process.argv[2]||'ourselves'}.html`));return;}
  const asset=path.replace(/^\/ext\//,'/');
  if(!/^\/(css|images|fonts)\/[\w/.-]+$/.test(asset)||asset.includes('..')){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',asset.endsWith('.css')?'text/css':asset.endsWith('.svg')?'image/svg+xml':'application/octet-stream');
  res.end(readFileSync(new URL(asset.slice(1),root)));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const browser=await chromium.launch({executablePath:process.env.STUDY_CHROMIUM,headless:true});
try {
 const page=await browser.newPage({viewport:{width:400,height:580}});
 await page.route('**/*',route=>route.request().url().startsWith(`http://127.0.0.1:${port}`)?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${port}/preview`);
 const height=await page.locator('.content-body-inner').evaluate(el=>Math.ceil(el.getBoundingClientRect().height));
 await page.setViewportSize({width:400,height:Math.max(160,Math.min(560,height+4))});
 await page.screenshot({path:`/tmp/study-card-${process.argv[2]||'ourselves'}-light.png`});
 const dimensions=await page.evaluate(()=>({width:innerWidth,bodyWidth:document.body.scrollWidth,contentHeight:document.querySelector('.content-body-inner').offsetHeight,buttons:[...document.querySelectorAll('.actions button')].filter(b=>getComputedStyle(b).display!=='none').map(b=>({text:b.textContent.trim(),width:b.getBoundingClientRect().width})),details:document.querySelectorAll('[data-sc-study-role=card] details').length}));
 if(dimensions.bodyWidth>dimensions.width)throw new Error('Horizontal overflow');
 console.log(JSON.stringify(dimensions));
 await page.locator('[data-sc-study-role=english]').evaluate(el=>el.open=true);
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.study-audio-sources')).backgroundColor==='rgb(36, 51, 46)');
 await page.screenshot({path:`/tmp/study-card-${process.argv[2]||'ourselves'}-dark.png`});
 await page.setViewportSize({width:280,height:420});
 if(await page.evaluate(()=>document.body.scrollWidth>innerWidth))throw new Error('Narrow viewport overflow');
 console.log('light/dark/narrow layout checked; dictionary detail expanded');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
