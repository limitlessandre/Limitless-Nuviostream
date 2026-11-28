#!/usr/bin/env node
"use strict";
const fs=require('node:fs');const {audit}=require('./provider-standards/check');
if(require.main===module){try{const args=process.argv.slice(2),strict=args.includes('--strict'),file=args.find(a=>!a.startsWith('--'));if(!file||args.some(a=>a.startsWith('--')&&!['--strict','--audit'].includes(a))||args.includes('--strict')&&args.includes('--audit'))throw Error('Usage: node scripts/check-provider-standards.js INPUT.json [--audit|--strict]');
 const result=audit(JSON.parse(fs.readFileSync(file,'utf8')));console.log(JSON.stringify({mode:strict?'strict':'audit',...result},null,2));process.exitCode=strict&&result.errors?1:0;
}catch(error){console.error('INPUT_ERROR: invalid/unreadable JSON or options. Supply the documented input schema; input contents are omitted.');process.exitCode=2;}}
module.exports=require('./provider-standards/check');
