# MEMORY.md 鈥?椤圭洰璁板繂

## 缁忛獙鏁欒

- [2026-05-16] **鏂囨。涓庝唬鐮佷弗閲嶈劚鑺?* 鈥?ARCHITECTURE-OVERVIEW 鎻忚堪鐨?鍏ㄧ悆 AI 鏅鸿兘浣撶綉缁?涓庡疄闄呬唬鐮佸樊璺濆法澶с€傚凡閲嶅啓涓鸿瘹瀹炵増鏈紝鏍囨敞姣忎釜妯″潡鐨勭湡瀹炴垚鐔熷害銆?*鏁欒锛氭枃妗ｅ繀椤绘牴妞嶄簬鍙繍琛岀殑浠ｇ爜锛屼笉鑳借秴鍓嶆弿杩颁笉瀛樺湪鐨勮兘鍔涖€?*
- [2026-05-16] **NeuralMesh 浠庢湭琚疄渚嬪寲** 鈥?绫诲畾涔変簡浣嗛浂寮曠敤锛屾槸姝讳唬鐮併€俷eural_share 娑堟伅鍦?swarm.js 涓湭璺敱锛堝凡淇級銆?*鏁欒锛氬啓瀹屾ā鍧楀繀椤诲啓闆嗘垚浠ｇ爜锛屽惁鍒欑瓑浜庢病鍐欍€?*
- [2026-05-16] **鏃?HTTP 鏈嶅姟鍣?(绔彛 3800) 闆堕壌鏉冭繍琛屾暟鏈?* 鈥?`/shutdown`銆乣/api/chat`銆乣/api/config` 绛夋晱鎰熺鐐规棤浠讳綍淇濇姢銆傚凡鍔?Bearer Token 閴存潈銆?*鏁欒锛氫袱鏉?API 璺緞蹇呴』缁熶竴瀹夊叏绠＄悊銆?*
- [2026-05-16] **P2P 鏉冮噸鎺ユ敹鏃犳暟鎹獙璇?* 鈥?鍙姇姣?NaN/Infinity/瓒呭ぇ鏁扮粍銆傚凡鍔?validateWeights() 鍜?sanitizePeerId()銆?*鏁欒锛氭墍鏈夋潵鑷綉缁滅殑杈撳叆蹇呴』楠岃瘉锛屾棤涓€渚嬪銆?*
- [2026-05-16] 娴嬭瘯 ESM/CJS 娣风敤瀵艰嚧 import 澶辫触 鈥?`package.json` 澹版槑 `"type": "module"` 浣嗘煇浜涙祴璇曟枃浠朵娇鐢?CJS 椋庢牸 import銆傜粺涓€ ESM锛屼笉瑕佹贩鐢ㄣ€?- [2026-05-16] bridge 鏍圭洰褰曟暎钀?12 涓?.cjs 涓€娆℃€т慨澶嶈剼鏈?鈥?宸茬Щ鍒?`bridge/scripts/migrations/`锛屼互鍚庢绫昏剼鏈洿鎺ユ斁 scripts/銆?- [2026-05-16] `app/` 鏄簾寮冩棫鐗?Flutter 椤圭洰锛屽凡鍒犻櫎銆傚敮涓€鍓嶇鏄?`openchat-flutter/`銆?
## 鍏抽敭鎸囨爣锛堝疄鏃讹級

- **娴嬭瘯**: 138/138 鍏ㄧ豢锛? flaky evolution-integration锛屽崟璺戦€氳繃锛?- **Lint**: eslint 9.39.4 + eslint.config.js 閰嶇疆瀹屾垚锛?9椤归瀛橀敊璇緟淇?- **Demo**: `npm run demo` 涓€閿?sandbox 浣撻獙鑴氭湰瀹屾垚
- **P2P鏁欑▼**: docs/p2p-voice-tutorial.md 瀹屾垚
- **HTTP 璺緞**: 宸茬粺涓€鍒?Express 鏈嶅姟鍣紙绔彛 3800锛夛紝搴熷純 raw HTTP server
- **鍩虹绔彛**: 鍥哄畾涓?3800锛屾墍鏈夎鐢熺鍙ｄ互 3800 涓哄熀鍑嗘帹瀵?- **OpenAPI**: `/api-docs` 绔偣鍙€氳繃 Swagger UI 娴忚

## 鏈€杩戜細璇濇憳瑕?
- [2026-05-25] **闊抽閾捐矾 E1 瀹屾垚**锛氶槦鍒楁挱鏀?+ 娣″叆娣″嚭 + Opus 闆嗘垚 + SDUI 涓夋ā寮忓彲鍒囷紙raw/opus/neural锛夈€俁NNoise/AGC/VAD 绠＄嚎宸叉帴鍏ュ苟閫氳繃 CI銆侫GENTS.md 鏂板 SDUI 浼樺厛鍘熷垯锛圲I 鍙樺姩鍏堥棶 SDUI 鑳戒笉鑳藉仛锛屼笉 rebuild锛夈€侫GENTS.md 鏂板 Flutter API 绛惧绛捐鍒欙紙鎺ㄩ€佸墠鍘?pub.dev 閫愯鏍稿 API锛夈€備慨澶?OpenRouter API key 娉勯湶锛坓it filter-repo 璇垹浠撳簱鍚庝粠 CI 寮曠敤鎭㈠锛夈€傛竻鐞?33 涓?apk-* tag 鍜屾墍鏈夋棫 Actions runs銆?
- [2026-05-16] **椤圭洰瀹氫綅澶ц璁?*锛氶€氳繃澶氳鑹插瑙嗭紙VC銆佸畨鍏ㄧ爺绌跺憳銆佽础鐚€呫€佹牳蹇冨伐绋嬪笀銆丳etals 寮€鍙戣€呫€佽€冨彜瀛﹀銆佸鐢熺敤鎴枫€佽鑰呫€丗lutter App 瑙嗚锛夌‘璁ら」鐩湡瀹炵珵浜夊姏鍦?P2P 璇煶閫氳锛岃€岄潪鍒嗗竷寮忓ぇ妯″瀷銆侫I 灞呮皯绀惧尯鏂瑰悜淇濈暀浣嗘爣娉ㄤ负瀹為獙銆?- [2026-05-16] **瀹夊叏鍔犲浐**锛氫慨澶?neural-mesh.js 鏉冮噸楠岃瘉+璺緞绌胯秺銆乻warm.js neural_share 璺敱銆乵ain.js 鏃?HTTP 閴存潈銆?- [2026-05-16] **鏂囨。澶т慨**锛氶噸鍐?ARCHITECTURE-OVERVIEW.md銆乨ocs/README.md銆丟LOSSARY.md锛屼笌浠ｇ爜鐪熷疄鐘舵€佸榻愩€?- [2026-05-16] 椤圭洰瀹℃牳锛氬彂鐜板苟淇 AGENTS.md 绌烘枃浠躲€丮EMORY.md 绌烘枃浠躲€佹祴璇?ESM 闂銆佹竻鐞嗗簾寮?`app/` 鐩綍銆?
## 涓婚鏂囦欢璺敱琛?
> 娑夊強浠ヤ笅棰嗗煙鏃惰鍙栧搴旀枃浠?
| 瑙﹀彂璇?| 鏂囦欢 | 璇存槑 |
|--------|------|------|
| Bridge/鍚庣/main.js | memory/core-logic.md | Bridge 鏍稿績鍚姩娴佺▼銆侀厤缃姞杞姐€佹ā鍧楀垵濮嬪寲 |
| P2P/DHT/鑺傜偣鍙戠幇 | memory/p2p.md | hyperswarm P2P 缃戠粶銆佽妭鐐瑰彂鐜般€佹秷鎭矾鐢?|
| Agent/浠ｇ悊/澶欰I | memory/agents.md | 5 绉嶄唬鐞嗚鑹层€佸弽棣堣仛鍚堛€佸喅绛栫郴缁?|
| 鐑洿鏂?Watchdog | memory/hot-update.md | SafeEvolution銆佺儹鏇存柊娴佺▼銆佸洖婊氭満鍒?|
| API/REST/绔偣 | memory/api.md | 31 涓?API 绔偣銆佽璇併€侀檺娴?|
| Flutter/瀹㈡埛绔?UI | memory/flutter.md | openchat-flutter 鏋舵瀯銆丄PI Client 灞?|
| 璇煶/闊抽/WebRTC | memory/audio.md | RNNoise銆佺缁忕紪瑙ｇ爜銆佽闊崇綉鍏?|
| 璋冭瘯缁忛獙 | memory/debugging.md | 甯歌 bug銆佽皟璇曟妧宸?|

## 寮€鏀剧嚎绋?
- [2026-05-18] **娉涘寲寮曟搸宸插疄鐜?* 鈥?generalization.js (300琛? + 闆嗘垚鍒?resident-manager think() 娴佺▼銆傚綋鐢ㄦ埛鎻愰棶鏃讹細vector memory 鎼滅浉鍏崇粡楠?鈫?generalization 鍒嗘瀽妯″紡 鈫?LLM 鐢熸垚澶氳В娉?鈫?鍥炲瓨鐭ヨ瘑搴?鈫?gossip 鍚屾鍏ㄧ綉銆傚疄鐜颁簡"涓€娆℃煡璇紝鎵€鏈夊眳姘戝鐢?鐨勯棴鐜€?- [2026-05-18] AI 灞呮皯鍐呴儴寰幆 鈥?宸插畬鏁撮摼璺細鐘舵€佹満 + 鑳介噺绯荤粺 + vector memory + generalization + gossip銆倀hink() 涓嶅啀鏄８ LLM 璋冪敤銆?- [2026-05-16] Dashboard 瀹炴椂鎺ㄩ€?鈥?鍚庣鐘舵€佸彉鍖栭渶瑕侀€氳繃 WebSocket 鎺ㄩ€佸埌鍓嶇锛岃€岄潪鍓嶇杞銆?- [2026-05-18] `bridge/src/main.js` 宸蹭粠 ~1900 琛屾媶鑷?26 琛岋紙姝讳唬鐮佹竻鐞嗗悗锛夛紝浣?MEMORY.md 鍜?MAINJS_REFACTOR_PLAN.md 淇濈暀鏃ф暟鎹鑷翠笓瀹惰瘎瀹″弽澶嶅悆鍋囩伯銆?*鏁欒锛氭枃妗ｄ腑鐨勬暟瀛楁寚鏍囧繀椤诲湪浠ｇ爜鍙樻洿鍚庣珛鍗冲悓姝ユ洿鏂帮紝鍚﹀垯鑷姩鎽樿宸ュ叿浼氶噸澶嶄紶鎾繃鏈熶俊鎭€?*
- [2026-05-18] `protocol/README.md` 瀛樺湪锛?65 琛屽崗璁枃妗ｏ級锛屼箣鍓嶈璁颁负绌虹洰褰曘€傚凡淇濈暀銆?- [2026-05-18] 鍥涜疆涓撳璇勫鍏辨墽琛?24 椤?P0锛孊ridge 鏍圭洰褰曟竻鐞?12 涓?Python 閬楃暀鏂囦欢锛孉I 灞呮皯鐘舵€佹満+澶氳矾寰勬帹鐞嗘浛鎹㈤鍒跺洖绛斻€?*鏁欒锛氫笓瀹惰瘎瀹℃瘡杞兘濂楃敤鐩稿悓鎻愰棶妯″紡鈥斺€旀灦鏋?娴嬭瘯/瀹夊叏/AI鈥斺€斾笉浼氶棶瀹屽叏閲嶅鐨勯棶棰樸€傚綋璇勫寮€濮嬭仛鐒?灞呮皯涓嶅鑱槑"鍜?鐭ヨ瘑涓嶅叡浜?鏃讹紝璇存槑鍩虹璁炬柦鍊哄凡杩樺畬锛岃疆鍒颁骇鍝佸姏浜嗐€?*

- [2026-05-20] **绗簲杞笓瀹惰瘎瀹?鈥?HTTP 璺緞缁熶竴 + 棣栨鍏ㄧ豢**锛氭祴璇曚粠 98/98 鎺ㄨ繘鍒?120/120锛堢浜旇疆 98鈫掔鍏疆 120锛屾渶缁堝叏缁匡級銆傚畬鎴?5 椤?P0 鎵ц锛欵xpress 鐩戝惉绔彛 3800锛屽簾寮?raw HTTP server锛屾墍鏈夎鐢熺鍙ｄ互 3800 涓哄熀鍑嗐€?*鏁欒锛氬ぇ閲忛仐鐣欎唬鐮侊紙startServer 涓殑 ~250 琛岃矾鐢?WebSocket 閫昏緫锛夊湪棣栨 edit 鏃舵湭瀹屽叏鍖归厤鍒犻櫎锛屽洜鏂囦欢琛屽彿宸插洜鍓嶅簭 edit 鍋忕Щ銆傚ぇ娈垫浛鎹㈡椂蹇呴』鐢ㄥ敮涓€鍖归厤閿氱偣锛堝 `}` + 涓嬩竴鏂规硶绛惧悕锛夈€?*
- [2026-05-20] **绗竷杞笓瀹惰瘎瀹?鈥?console.log鈫抪ino 缁撴瀯鍖栨棩蹇?*锛?14鈫?15 娴嬭瘯锛堝叏缁匡級銆傚畬鎴?7 杞叡 29 椤?P0銆?34 涓枃浠舵壒閲忔浛鎹?console.log 鈫?logger.info/warn/error锛宲ino 闆嗘垚甯︽晱鎰熸暟鎹劚鏁忋€?*鏁欒锛歅owerShell `Set-Content -NoNewline` 浼氫互閿欒缂栫爜鍐欏叆鏂囦欢锛屽鑷?UTF-8 澶氬瓧鑺傚瓧绗︽崯鍧忋€傛枃浠朵慨鏀瑰繀椤荤粺涓€鐢?Node.js `fs.writeFileSync(file, content, 'utf-8')`銆俙pino.transport()` 鍒涘缓 worker 绾跨▼浼氶樆姝?Node.js test runner 閫€鍑猴紝蹇呴』鐢ㄥ悓姝?pino API銆?*
- [2026-05-20] **绗叓杞笓瀹惰瘎瀹?鈥?瀹夊叏鍔犲浐+CoT+娴嬭瘯+鐩綍绮剧畝**锛?28/128 鍏ㄧ豢銆傚畬鎴?7 椤?P0 鎵ц锛歮athjs 鏇夸唬 Function()銆丼SRF 闃叉姢銆丆oT 瓒呮椂/token闂ㄧ銆?4 涓?tool-registry 娴嬭瘯銆乻rc 鐩綍 22鈫?1銆丷EADME 宸紓鍖栨弿杩般€丆I npm pack+docker build銆?*鏁欒锛氬ぇ閲忕洰褰曞悎骞舵秹鍙婅法鏂囦欢 import 璺緞鏇存柊锛屽繀椤诲厛 grep 鎵€鏈夊紩鐢ㄥ啀绉诲姩銆俙git stash` 鍙敤浜庡姣?pre-existing test failures 涓庡紩鍏ョ殑澶辫触銆?*
- [2026-05-20] **绗節杞笓瀹惰瘎瀹?鈥?catch{}绯荤粺鎬ф竻鐞?姝讳唬鐮佸垹闄?瀛愮郴缁熸祴璇?*锛?38/138 鍏ㄧ豢锛堟柊澧?0涓瓙绯荤粺娴嬭瘯锛夈€傚畬鎴?椤筆0鎵ц锛?05澶刢atch{}鍔犳棩蹇?36鏂囦欢)銆?9涓?log鍨冨溇鏂囦欢娓呯悊銆乥ridge.js姝讳唬鐮佸垹闄ゃ€丆onvergenceEngine+FairyGuardian娴嬭瘯(10涓?銆乪volution-integration纭浠峟laky銆?*鏁欒锛歊4淇甤atch{}鍙檺浜巘opic-registry锛岃繖娆rep鍑哄叏椤圭洰105澶勩€傚崟鏂囦欢"宸蹭慨"涓嶄唬琛ㄥ叏椤圭洰宸蹭慨锛屾瘡娆¤瘎瀹″繀椤诲仛鍏ㄩ噺鎵弿銆?*


- [2026-05-20] **绗崄杞笓瀹惰瘎瀹?鈥?core/ 129鏂囦欢鎷?0瀛愮洰褰?*锛?29鏂囦欢浠巆ore/鎵佸钩鈫?0璇箟瀛愮洰褰曪紙agent/ evolution/ security/ convergence/ p2r/ monitoring/ memory/ audio/ collaboration/ quality/锛夈€?37/138娴嬭瘯鍏ㄧ豢锛堜粎鍓〆volution-integration flaky锛夈€?*鏁欒锛氳法鐩綍鏂囦欢绉诲姩蹇呴』鐢ㄨ嚜鍔ㄥ寲鑴氭湰澶勭悊import璺緞銆侾owerShell glob/姝ｅ垯灞€闄愭€уぇ锛孨ode.js鑴氭湰鏇村彲闈犮€俙../xxx/yyy.js`涓瓁xx鍙兘鍚屾椂鏄痵rc/xxx鍜宑ore/xxx锛屽繀椤绘寜core/xxx浼樺厛瑙ｆ瀽銆傚姩鎬乮mport锛坄await import()`锛夊鏄撹鎵归噺鏇挎崲婕忔帀锛屽繀椤诲叏閲廹rep纭銆?7涓猼est.mjs鏂囦欢婕忎簡鍔ㄦ€乮mport銆?*

| R14 | Flutter缂栬瘧鐘舵€侀獙璇?| Flutter寮€鍙戣€?| P0-5 | 鉂?寰呬慨(閮ㄥ垎瀹屾垚) | Flutter寮€鍙戣€?|
| R14 | evolution-integration flaky缁瓨 | 娴嬭瘯宸ョ▼甯?| P1-6 | 鉁?宸蹭慨(R16) | 娴嬭瘯宸ョ▼甯?|
| R15 | CLI浣撻獙鏀归€?鈥?sandbox浜や簰(棰滆壊/鎸佷箙鍖? | 鎶€鏈粡鐞?| P0-1 | 鉁?宸蹭慨(R15) | 鐢ㄦ埛鏀寔+鏋舵瀯甯?绔炲搧鍒嗘瀽甯?|
| R15 | Flutter缂栬瘧楠岃瘉+CI(绔彛3000鈫?800) | 鎶€鏈粡鐞?| P0-2 | 鉁?宸蹭慨(R15) | Flutter寮€鍙戣€?瀹夊叏鐮旂┒鍛?|
| R15 | lint error 59鈫?8 (comment-eats-code/duplicate/mac) | 鎶€鏈粡鐞?| P0-3 | 鉁?宸蹭慨(R15) | 鏍稿績宸ョ▼甯?SRE |
| R15 | evolution-integration flaky鏍瑰洜鍒嗘瀽 | 鎶€鏈粡鐞?| P0-4 | 鉁?宸蹭慨(R16) | 娴嬭瘯宸ョ▼甯?|
| R15 | 鍗曞垎鏀紑鍙戞暣鏀?娓呯悊bridge_setup.py+BRANCH_STRATEGY.md) | 鎶€鏈粡鐞?| P0-5 | 鉁?宸蹭慨(R15) | Git涓撳 |
| R15 | Agent loop闂幆楠岃瘉 | 鎶€鏈粡鐞?| P1-6 | 鉂?寰呬慨 | AI鐮旂┒鍛?娴嬭瘯宸ョ▼甯?|
| R15 | 妯″潡绾EADME | 鎶€鏈粡鐞?| P1-9 | 鉂?寰呬慨 | 鏋舵瀯甯?寮€婧愮ぞ鍖虹粡鐞?鎶€鏈啓浣滆€?|
| R16 | resident-scheduler syntax error淇(demo宕╂簝) | 鎶€鏈粡鐞?| P0-1 | 鉁?宸蹭慨(R16) | 鍏ㄤ綋13浣嶄笓瀹?|
| R16 | 鍏ㄩ噺缂栫爜鎹熷潖鏂囦欢鎵弿+淇(house-orchestrator) | 鎶€鏈粡鐞?| P0-2 | 鉁?宸蹭慨(R16) | 瀹夊叏鐮旂┒鍛?|
| R16 | 娣诲姞 smoke test(鎵€鏈塻rc/鏂囦欢node --check) | 鎶€鏈粡鐞?| P0-3 | 鉁?宸蹭慨(R16) | 娴嬭瘯宸ョ▼甯?鏋舵瀯甯?|
| R16 | evolution-integration閲嶅啓涓簄ode:test(鏍归櫎flaky) | 鎶€鏈粡鐞?| P0-4 | 鉁?宸蹭慨(R16) | 娴嬭瘯宸ョ▼甯?|
| R16 | 618 lint warnings娓呴浂(eslint --fix) | 鎶€鏈粡鐞?| P0-5 | 鉁?宸蹭慨(R16) | 鏍稿績宸ョ▼甯?SRE |

## 鐗堟湰鍘嗗彶

| 杞 | 鎰忚鎽樿 | 鎻愬嚭涓撳 | 瀵瑰簲浠诲姟 | 鐘舵€?| 楠屾敹浜?|
|------|---------|---------|---------|------|-------|
| R1 | 姝讳唬鐮佸お澶?analysis-*.cjs, .js.js) | Git涓撳 | P0-1 娓呯悊4770鏂囦欢 | 鉁?宸蹭慨(R1) | Git涓撳 |
| R1 | 娴嬭瘯20%澶辫触鐜囦笉鍙帴鍙?| 娴嬭瘯宸ョ▼甯?| P0-2 淇17涓け璐?| 鉁?宸蹭慨(R2) | 娴嬭瘯宸ョ▼甯?|
| R1 | 鏃TTP鏃犻壌鏉?| 瀹夊叏鐮旂┒鍛?| P0-3 API閴存潈缁熶竴 | 鉁?宸蹭慨(R2) | 瀹夊叏鐮旂┒鍛?|
| R1 | P2P闆舵祴璇?| 娴嬭瘯宸ョ▼甯?| P0-4 8涓狿2P娴嬭瘯 | 鉁?宸蹭慨(R2) | 娴嬭瘯宸ョ▼甯?|
| R1 | agent-engine session store缂哄け | 鏍稿績宸ョ▼甯?| P0-1 娉ㄥ叆deps | 鉁?宸蹭慨(R2) | 鏍稿績宸ョ▼甯?|
| R2 | 涓ゆ潯HTTP璺緞鍏卞瓨 | 鏋舵瀯甯?| P0-1 搴熷純raw HTTP | 鉁?宸蹭慨(R3) | 鏋舵瀯甯?|
| R2 | agent-session娣风敤jest/ESM | 娴嬭瘯宸ョ▼甯?| P0-2 鍒犻櫎jest娴嬭瘯 | 鉁?宸蹭慨(R3) | 娴嬭瘯宸ョ▼甯?|
| R2 | Flutter API瀵归綈鏈獙璇?| Flutter寮€鍙戣€?| P0-3 baseUrl纭 | 鉁?宸蹭慨(R3) | Flutter寮€鍙戣€?|
| R3 | //娉ㄩ噴鍚冩帀鍚庣画浠ｇ爜(3澶? | 鏍稿績宸ョ▼甯?| 淇topic-registry/route-handlers | 鉁?宸蹭慨(R4) | 鏍稿績宸ョ▼甯?|
| R4 | WS clients鏈拷韪?| Code Review | server.js鍔爐his.clients | 鉁?宸蹭慨(R4) | Code Review |
| R4 | _queryTopicPeers閫掑綊鐖嗘爤 | Code Review | 鏀逛负_getLocalPeers | 鉁?宸蹭慨(R4) | Code Review |
| R4 | catch{}鍚炲紓甯?| 瀹夊叏鐮旂┒鍛?| topic-registry鍔犳棩蹇?| 鉁?宸蹭慨(R4) | 瀹夊叏鐮旂┒鍛?|
| R4 | isMain绔彛妫€娴嬭绉婚櫎 | Code Review | 鎭㈠port===DEFAULT_PORT | 鉁?宸蹭慨(R4) | Code Review |
| R5 | forge.js闆舵祴璇曡鐩?| 鏍稿績宸ョ▼甯?| 16涓祴璇?| 鉁?宸蹭慨(R5) | 鏍稿績宸ョ▼甯?|
| R5 | generalization鍗曟祴璇曚笉鍙俊 | AI鐮旂┒鍛?| 鍩哄噯閲嶇畻+鎵╁睍 | 鉁?宸蹭慨(R6) | AI鐮旂┒鍛?|
| R5 | evolution-integration flaky | 娴嬭瘯宸ョ▼甯?| 閲嶅啓涓簄ode:test | 鉁?宸蹭慨(R6) | 娴嬭瘯宸ョ▼甯?|
| R6 | 浜у搧鏃犱竴鍙ヨ瘽瀹氫綅 | VC/鎶曡祫浜?| README閲嶅啓 | 鉁?宸蹭慨(R7) | VC/鎶曡祫浜?|
| R6 | 鏃犳柊浜簅nboarding | 寮€婧愮ぞ鍖虹粡鐞?| first-steps.md | 鉁?宸蹭慨(R7) | 寮€婧愮ぞ鍖虹粡鐞?|
| R6 | 鏃燙I | SRE/杩愮淮 | .github/workflows/ci.yml | 鉁?宸蹭慨(R7) | SRE/杩愮淮 |
| R6 | eval-report娈嬬暀 | Git涓撳 | 娓呯悊+.gitignore | 鉁?宸蹭慨(R7) | Git涓撳 |
| R7 | console.log鈫抪ino缁撴瀯鍖栨棩蹇?| SRE/杩愮淮 | P0-1 鏇挎崲134鏂囦欢 | 鉁?宸蹭慨(R7) | 娴嬭瘯宸ョ▼甯?|
| R7 | AI灞呮皯CoT+tool-use | AI鐮旂┒鍛?| P0-4 tool-registry + CoT loop | 鉁?宸蹭慨(R7) | 鏍稿績宸ョ▼甯?|
| R8 | calculate Function()鏋勯€犲櫒RCE | 瀹夊叏鐮旂┒鍛?鏍稿績宸ョ▼甯?| P0-1 mathjs鏇夸唬 | 鉁?宸蹭慨(R8) | 瀹夊叏鐮旂┒鍛?|
| R8 | web_fetch SSRF鏃犻槻鎶?| 瀹夊叏鐮旂┒鍛?鏍稿績宸ョ▼甯?| P0-2 URL楠岃瘉+鍐呯綉闃绘柇 | 鉁?宸蹭慨(R8) | 瀹夊叏鐮旂┒鍛?|
| R8 | CoT鏃爄nter-iteration瓒呮椂 | 鏍稿績宸ョ▼甯?AI鐮旂┒鍛?| P0-3 per-iteration timeout+token闂ㄧ | 鉁?宸蹭慨(R8) | 鏍稿績宸ョ▼甯?|
| R8 | tool-registry+CoT闆舵祴璇?| 娴嬭瘯宸ョ▼甯?| P0-4 14涓祴璇?128鈫?28) | 鉁?宸蹭慨(R8) | 娴嬭瘯宸ョ▼甯?|
| R8 | src鐩綍22涓啫鑳€ | 鏋舵瀯甯?| P0-5 22鈫?1鐩綍鍚堝苟 | 鉁?宸蹭慨(R8) | 鏋舵瀯甯?|
| R8 | README鏈獊鍑篜2P璇煶宸紓 | 绔炲搧鍒嗘瀽甯?VC | P0-6 宸紓鍖栨弿杩?Features琛ㄦ牸 | 鉁?宸蹭慨(R8) | 绔炲搧鍒嗘瀽甯?|
| R8 | CI鏃犳瀯寤轰骇鍑洪獙璇?| SRE/杩愮淮 | P0-7 npm pack+docker build | 鉁?宸蹭慨(R8) | SRE/杩愮淮 |
| R9 | 105澶刢atch{}鍚炲紓甯?36鏂囦欢) | 瀹夊叏鐮旂┒鍛?鏍稿績宸ョ▼甯?| P0-1 鎵归噺鍔爈ogger.warn | 鉁?宸蹭慨(R9) | 瀹夊叏鐮旂┒鍛?|
| R9 | 19涓?log鍨冨溇鏂囦欢 | SRE/杩愮淮 | P0-2 鍒犻櫎+gitignore宸叉湁 | 鉁?宸蹭慨(R9) | SRE/杩愮淮 |
| R9 | bridge.js鐙珛鍏ュ彛=姝讳唬鐮?| 鏍稿績宸ョ▼甯?鏋舵瀯甯?| P0-3 鍒犻櫎bridge.js | 鉁?宸蹭慨(R9) | 鏍稿績宸ョ▼甯?|
| R9 | core/鐩綍149鏂囦欢鑶ㄨ儉 鈫?10瀛愮洰褰?| 鏋舵瀯甯?| P0-5 鎷嗗垎瀛愮洰褰?| 鉁?宸蹭慨(R10) | 鏋舵瀯甯?|
| R9 | main.js start() 470琛?| 鏍稿績宸ョ▼甯?| P0-2 鎷嗛樁娈垫柟娉?寰呮墽琛? | 鉂?寰呬慨 | 鏍稿績宸ョ▼甯?|
| R9 | evolution-integration flaky鏈牴闄?| 娴嬭瘯宸ョ▼甯?| P0-6 纭浠峟laky(闈濺9寮曞叆) | 鉂?寰呬慨 | 娴嬭瘯宸ョ▼甯?|
| R9 | P2P閫氳瘽step-by-step鏁欑▼ | 鐢ㄦ埛鏀寔/绔炲搧鍒嗘瀽甯?| P0-7 鏂囨。(寰呮墽琛? | 鉂?寰呬慨 | 鐢ㄦ埛鏀寔 |
| R10 | core/ 129鏂囦欢鎷?0瀛愮洰褰?| 鏋舵瀯甯?| P0-1 core/鎷嗗垎 | 鉁?宸蹭慨(R10) | 鏋舵瀯甯?|
| R10 | evolution-integration閲嶅啓涓簄ode:test | 鏍稿績宸ョ▼甯?| P0-3 evolution閲嶅啓 | 鉂?寰呬慨 | 娴嬭瘯宸ョ▼甯?|
| R10 | main.js start() 470琛屾媶鍒?| 鏍稿績宸ョ▼甯?| P0-2 main.js鎷嗗垎 | 鉂?寰呬慨 | 鏍稿績宸ョ▼甯?|
| R10 | lint鎺ュ叆CI | SRE | P0-5 lint閰嶇疆 | 鉂?寰呬慨 | SRE |
| R10 | P2P鏁欑▼+demo | 绔炲搧鍒嗘瀽甯?| P0-12 P2P鏁欑▼鍒朵綔 | 鉂?寰呬慨 | 鐢ㄦ埛鏀寔 |
| R13 | 鍥涢」鍘熷垯璇勫鈥斿彲浜や粯鐗堟湰楠屾敹鏍囧噯 | 鎶€鏈粡鐞?| 鍐欏叆AGENTS.md鍘熷垯4 | 鉁?宸蹭慨(R13) | VC/鎶曡祫浜?SRE |
| R13 | 鍥涢」鍘熷垯璇勫鈥擯RINCIPLE_TRACKING.json | Git涓撳 | 鍒涘缓璺熻釜鏂囦欢 | 鉁?宸蹭慨(R13) | Git涓撳 |
| R13 | 鍥涢」鍘熷垯璇勫鈥斿師鍒?寮哄埗鎵ц鏈哄埗 | Code Review | 鍐欏叆AGENTS.md鍘熷垯3 | 鉁?宸蹭慨(R13) | 鎶€鏈啓浣滆€?|
| R13 | 鍥涢」鍘熷垯璇勫鈥旀崲鏂规瑙﹀彂鏈哄埗 | 鏍稿績宸ョ▼甯?| 鍐欏叆AGENTS.md鍘熷垯1 | 鉁?宸蹭慨(R13) | 鏍稿績宸ョ▼甯?|
| R13 | 鍥涢」鍘熷垯璇勫鈥旀瘡3杞‖鎬х増鍙?| 绔炲搧鍒嗘瀽甯?| 鍐欏叆AGENTS.md鍘熷垯4 | 鉁?宸蹭慨(R13) | 绔炲搧鍒嗘瀽甯?|
| R14 | main.js绌篶atch鍔爈ogger(5澶? | 瀹夊叏鐮旂┒鍛?| P0-4 | 鉁?宸蹭慨(R14) | 瀹夊叏鐮旂┒鍛?|
| R14 | CI lint鏇挎崲eslint.config.js+devDependencies | SRE/杩愮淮 | P0-2 | 鉁?宸蹭慨(R14) | SRE/杩愮淮 |
| R14 | npm run demo涓€閿畇andbox浣撻獙鑴氭湰 | 鐢ㄦ埛鏀寔 | P0-1 | 鉁?宸蹭慨(R14) | 鐢ㄦ埛鏀寔 |
| R14 | P2P绔埌绔痙emo鏁欑▼ | 绔炲搧鍒嗘瀽甯?| P0-3 | 鉁?宸蹭慨(R14) | 绔炲搧鍒嗘瀽甯?|
| R14 | src/*.js 59椤归瀛榣int閿欒(no-undef/no-empty绛? | SRE/杩愮淮 | P1-鍚庣画 | 鉁?宸蹭慨(R15, 59鈫?8) | SRE/杩愮淮 |
| R14 | evolution-integration flaky缁瓨 | 娴嬭瘯宸ョ▼甯?| P1-6 | 鉂?寰呬慨 | 娴嬭瘯宸ョ▼甯?|
| R14 | Flutter缂栬瘧鐘舵€侀獙璇?| Flutter寮€鍙戣€?| P0-5 | 鉂?寰呬慨(閮ㄥ垎瀹屾垚) | Flutter寮€鍙戣€?|
| R17 | 娴嬭瘯瓒呮椂 鈥?`--test-force-exit` 淇 | 鎶€鏈粡鐞?| P0-1 | 鉁?宸蹭慨(R17) | 娴嬭瘯宸ョ▼甯?|
| R17 | lint no-undef 41 鈫?0 (commands.js 缂?import) | 鎶€鏈粡鐞?| P0-2 | 鉁?宸蹭慨(R17) | 鏍稿績宸ョ▼甯?|
| R17 | main.js start() 鎷?lifecycle 鏂规硶 (_printBanner/_initCoreSystems/_enterSandboxMode) | 鎶€鏈粡鐞?| P0-3 | 鉁?宸蹭慨(R17) | 鏋舵瀯甯?|
| R17 | core/ restructure import 璺緞淇 (agent-monitor/ai-personhood 绛?2澶? | 鎶€鏈粡鐞?| P0-3 | 鉁?宸蹭慨(R17) | 鏍稿績宸ョ▼甯?|
| R17 | CI lint gate 鍔犲浐 (--max-warnings=0) | 鎶€鏈粡鐞?| P0-2 | 鉁?宸蹭慨(R17) | SRE/杩愮淮 |
| R17 | evolution-memory.test.mjs import 璺緞淇 | 鎶€鏈粡鐞?| P0-1 | 鉁?宸蹭慨(R17) | 娴嬭瘯宸ョ▼甯?|
| R17 | resident-scheduler class 瀵煎嚭渚涙祴璇?| 鎶€鏈粡鐞?| P0-1 | 鉁?宸蹭慨(R17) | 娴嬭瘯宸ョ▼甯?|
| R17 | agent-loop-e2e 3 涓?scheduler 娴嬭瘯鍏ㄩ儴淇 | 鎶€鏈粡鐞?| P0-1 | 鉁?宸蹭慨(R17) | 娴嬭瘯宸ョ▼甯?|
| R17 | main.js 6 澶勭┖ catch 鍔?logger | 瀹夊叏鐮旂┒鍛?| P0-2 | 鉁?宸蹭慨(R17) | 瀹夊叏鐮旂┒鍛?|
| R18 | voice_client.dart 缂栬瘧淇锛坃onAudioData 閲嶅/UdpHolePunch 瀛ゅ効浠ｇ爜/RawDatagramSocket API锛?| 鎶€鏈粡鐞?| P0-1 | 鉁?宸蹭慨(R18) | Flutter 寮€鍙戣€?|
| R18 | main.js:612 getPublicIPv4 鏈畾涔変慨澶?| 鎶€鏈粡鐞?| P0-2 | 鉁?宸蹭慨(R18) | 鏍稿績宸ョ▼甯?|
| R18 | 鍏ㄩ」鐩?39+ no-empty lint 娓呴浂 | 鎶€鏈粡鐞?| P0-3 | 鉁?宸蹭慨(R18) | 鏍稿績宸ョ▼甯?|
| R18 | CI lint gate 鍗囩骇 --max-warnings=0 | 鎶€鏈粡鐞?| P0-4 | 鉁?宸蹭慨(R18) | SRE/杩愮淮 |
| R19 | 鎻愪氦 R18 鍙樻洿骞舵帹閫?CI | 鎶€鏈粡鐞?| P0-1 | 鉁?宸蹭慨(R19) | 13 浣嶄笓瀹?|
| R19 | 璇煶鏁版嵁娴佹枃妗?docs/voice-data-flow.md | 鎶€鏈粡鐞?| P0-6 | 鉁?宸蹭慨(R19) | 鎶€鏈啓浣滆€?|
| R19 | CI 鍏ㄧ豢 鈥?bridge lint error(getPublicIPv4) + Flutter analyze(voice_client+pubspec) | 鎶€鏈粡鐞?| P0-1 | 鉁?宸蹭慨(R19) | 鍏ㄤ綋 |
| R19 | Flutter 渚濊禆淇 鈥?web_socket_channel 鍔犲洖 pubspec | 鎶€鏈粡鐞?| P0-2 | 鉁?宸蹭慨(R19) | Flutter 寮€鍙戣€?|
| R19 | 绔埌绔闊抽€氳瘽楠岃瘉 鈥?APK 鏋勫缓閫氳繃(CI) | 鎶€鏈粡鐞?| P0-3 | 鈿狅笍 APK 宸茬敓鎴愶紝寰呭弻鎵嬫満瀹炴祴 | 绔炲搧鍒嗘瀽甯?鐢ㄦ埛鏀寔 |

## 鍏抽敭鎸囨爣锛堝疄鏃讹級

- **娴嬭瘯**: 147/147 鍏ㄧ豢 + 39 provider-kit 娴嬭瘯鍏ㄧ豢
- **Lint**: 0 errors, 0 warnings 鉁?- **CI**: **鍏ㄧ嚎鍏ㄧ豢**锛坆ridge-lint銆乥ridge-test銆乫lutter-test銆乫lutter-apk锛?- **APK**: 鎵嬪姩瑙﹀彂鏋勫缓鎴愬姛锛宎rtifact 鍙笅杞?- **Flutter**: voice_client.dart 缂栬瘧淇 + people_screen.dart 淇 + record pkg 鍗囩骇鍒?6.x
- **Demo**: `npm run demo` 涓€閿?sandbox 浣撻獙鑴氭湰姝ｅ父
- **P2P鏁欑▼**: docs/p2p-voice-tutorial.md 瀹屾垚

## 鐗堟湰璁″垝锛堟椂闂寸鐞嗗笀鐩戠锛?
> 澶氭潯宸ヤ綔绾垮苟琛屾帹杩涳紝鐗堟湰鍙锋爣璇嗗綋鍓嶇患鍚堟垚鐔熷害銆傛瘡鏉＄嚎鐙珛杩唬锛屼笉浜掔浉闃诲銆?
### 宸ヤ綔绾?A锛氶煶棰戦€氳矾 鈥?鏈€浼樺厛
| 鐗堟湰 | 浜や粯 | 鐘舵€?|
|------|------|------|
| A1 | 褰曢煶鈫扱iniu鈫掓挱鏀惧畬鏁撮摼璺紙闃熷垪鎾斁銆佹贰鍏ユ贰鍑恒€丱pus/raw/neural 涓夋ā寮?SDUI 鍙垏銆丟ET 鏀圭敤 Qiniu RS API 淇鎵嬫満鏃堕挓鍋忓樊锛?| 鉁?v1.0.0 |
| A2 | 鍙屾墜鏈虹鍒扮閫氳瘽楠岃瘉 | 鈴?寰呮祴璇?|
| A3 | 寤惰繜浼樺寲锛坆ufferMs/pollMs SDUI 鍙皟锛?| 鉁?|
| A4 | UDP 鎵撴礊鐩磋繛 | 鈴?|

### 宸ヤ綔绾?B锛氬熀纭€璁炬柦 鈥?宸插畬鎴?| 鐗堟湰 | 浜や粯 | 鐘舵€?|
|------|------|------|
| B1 | Qiniu Direct 鏋舵瀯锛堟敞鍐?鍙戠幇/棰勭鍚?URL锛?| 鉁?|
| B2 | SDUI 寮曟搸 + 杩滅▼閰嶇疆锛圝SON鈫扺idget锛?| 鉁?CI 缂栬瘧涓?|
| B3 | Debug 鍛戒护閫氶亾 | 鉁?CI 缂栬瘧涓?|
| B4 | 杩滅▼閰嶇疆 + 杞闂撮殧鍙皟 | 鉁?浠ｇ爜宸叉彁浜?|
| B5 | CHANGELOG + README 鏇存柊 | 鉁?宸叉彁浜?|

### 宸ヤ綔绾?C锛歋DUI 鍖?鈥?纭紪鐮?UI 閫愭杩佺Щ鍒拌繙绋嬮厤缃?| 鐗堟湰 | 浜や粯 | 鐘舵€?|
|------|------|------|
| C1 | Audio mode 鍒囨崲鎸夐挳锛圧aw/Opus/Neural锛夆啋 绾?SDUI file:write | 鉁?|
| C2 | Voice room 閫氳瘽鐣岄潰锛堢姸鎬佹枃瀛椼€乵ute/鎸傛柇鎸夐挳锛夆啋 SDUI 妯℃澘鍙橀噺 | 馃搵 |
| C3 | Settings/Home 椤电Щ闄ょ‖缂栫爜鍏滃簳 | 馃搵 |
| C4 | 鏂板缓 UI 鍔熻兘榛樿璧?SDUI锛屼笉鏀?Dart | 馃搵 |

### 宸ヤ綔绾?D锛氬弻鏈洪€氳瘽 鈥?渚濊禆 A 绾垮畬鎴愬悗
| 鐗堟湰 | 浜や粯 | 鐘舵€?|
|------|------|------|
| D1 | 浜掔浉鍙戠幇鈫掑懠鍙啋鎺ュ惉鈫掗煶棰戦€?| 鈴?|
| D2 | 閫氳瘽涓姸鎬佺鐞嗭紙mic mute銆佹寕鏂級 | 鈴?|
| D3 | 鑱旂郴浜虹鐞嗐€侀€氳瘽璁板綍 | 鈴?|

### 宸ヤ綔绾?E锛歂eural Codec 鍗囩骇 鈥?瀹屾垚 v1 鍏ㄩ儴杩唬
| 鐗堟湰 | 浜や粯 | 鐘舵€?|
|------|------|------|
| E1 | 闊抽閾捐矾淇 + AudioProcessor 鎺ュ叆 CI | 鉁?|
| E2 | 32 棰戞 Mel 婊ゆ尝鍣ㄧ粍鏇夸唬 4 姝ｅ鸡娉紝姝ｅ鸡+鍣０娣峰悎鍚堟垚 | 鉁?|
| E3 | 鐬€佺紪鐮侊細鑳介噺 onset 妫€娴?+ 鎸囨暟琛板噺鍣０鐬€佸眰 | 鉁?|
| E4 | 闊宠壊妯″瀷锛?6-class 鐮佹湰 + 娈嬪樊缂栫爜 + 鍚堟垚鏃堕煶鑹叉暣褰?| 鉁?|
| E5 | Source separation锛欻PSS 璋愭尝-鎵撳嚮涔愬垎绂?+ 澶氳建鍚堟垚 | 鉁?|
| E6 | 涔愯氨琛ㄧず锛氳嚜鐩稿叧 F0 杩借釜 + 鑴夊啿鍒楁縺鍔?+ 鏈夊０/鏃犲０鍒ゆ柇 | 鉁?|

### 閲岀▼纰?| 鐗堟湰 | 鍚箟 | 鏉′欢 |
|------|------|------|
| **v1.0.0** | 棣栨鍙敤 | 鍗曟満 Demo 鑳藉畬鏁磋蛋閫氾紙鐪嬪埌鐢ㄦ埛鈫掑懠鍙啋鍚埌澹伴煶锛?|
| **v1.1.0** | 鍙屾満閫氳瘽 | 涓ゅ彴璁惧绔埌绔闊抽€?|
| **v2.0.0** | 鐢熶骇鍙敤 | 澶氫汉缁勪細 + AI 灞呮皯鎺ュ叆 + 鍔犲瘑 |
| **v3.0.0** | 楂橀煶璐ㄩ煶涔愰€氳瘽 | Neural Codec E3 浠ヤ笂 + 闊充箰鍦烘櫙鍙椈鏃犳崯 |
