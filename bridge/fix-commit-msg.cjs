const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/core/learning-core.js');
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: Update _executeTasks to ensure bilingual commits
const oldExecuteTasks = `        } else if (task.type === 'run_command' && task.command) {
          const { exec } = await import('child_process');
          await new Promise((resolve, reject) => {
            exec(task.command, { cwd: process.cwd() }, (error, stdout, stderr) => {
              if (error) reject(error);
              else {
                console.log(\`[学习核心] ✅ 执行命令: \${task.command.substring(0, 50)}\`);
                if (stdout) console.log(\`  输出: \${stdout.trim().substring(0, 100)}\`);
                resolve();
              }
            });
          });
        }`;

const newExecuteTasks = `        } else if (task.type === 'run_command' && task.command) {
          let cmd = task.command;
          if (cmd.includes('git commit') && !cmd.includes(' / ')) {
            cmd = cmd.replace(/git commit -m ["']([^"']+)["']/, 'git commit -m "$1 / 自动提交"');
          }
          const { exec } = await import('child_process');
          await new Promise((resolve, reject) => {
            exec(cmd, { cwd: process.cwd() }, (error, stdout, stderr) => {
              if (error) reject(error);
              else {
                console.log(\`[学习核心] ✅ 执行命令: \${cmd.substring(0, 50)}\`);
                if (stdout) console.log(\`  输出: \${stdout.trim().substring(0, 100)}\`);
                resolve();
              }
            });
          });
        }`;

if (content.includes(oldExecuteTasks)) {
  content = content.replace(oldExecuteTasks, newExecuteTasks);
  console.log('✅ Updated _executeTasks method');
} else {
  console.log('⚠️ Could not find _executeTasks pattern to replace');
}

fs.writeFileSync(filePath, content);
console.log('Done!');
