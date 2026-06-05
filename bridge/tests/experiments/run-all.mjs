const scripts = [
  { name: '1. SDUI',      file: './1-sdui.mjs'      },
  { name: '2. Agent',     file: './2-agent.mjs'      },
  { name: '3. P2P',       file: './3-p2p.mjs'        },
  { name: '4. Codec',     file: './4-codec.mjs'      },
  { name: '5. Qiniu',     file: './5-qiniu.mjs'      },
  { name: '6. App',       file: './6-app.mjs'        },
  { name: '7. Isolation', file: './7-isolation.mjs'  },
  { name: '8. Naming',    file: './8-naming.mjs'     },
  { name: '9. Session',   file: './9-session.mjs'    },
  { name: '10. System',   file: './10-system-exec.mjs' },
  { name: '11. Token',    file: './11-token-saving.mjs' },
  { name: '12. Dev',      file: './12-software-dev.mjs' },
];

let allPass = true;
for (const s of scripts) {
  console.log(`\n▶ Running ${s.name}...`);
  try {
    await import(s.file);
  } catch (e) {
    console.error(`  ✗ ${s.name} 崩溃: ${e.message}`);
    allPass = false;
  }
}

console.log(`\n${'═'.repeat(40)}`);
if (allPass) console.log('所有实验通过 ✓');
else console.log('部分实验失败 ✗');
process.exit(allPass ? 0 : 1);
