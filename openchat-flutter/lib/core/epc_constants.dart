/// EPC 帧类型/子类型常量
/// 与 bridge/modules/provider-kit/src/providers/epc-codec.js 同步
/// LLM 按 opcode 直接分发，不需要 JSON 解析

// ─── 类型 ───
const int epcTypeLlm       = 0x10;
const int epcTypeAgent     = 0x11;
const int epcTypeMedia     = 0x12;
const int epcTypeImage     = 0x13;
const int epcTypeFs        = 0x14;
const int epcTypeS3        = 0x15;
const int epcTypeExec      = 0x16;
const int epcTypeChat      = 0x17;
const int epcTypeRoom      = 0x18;
const int epcTypeCall      = 0x19;
const int epcTypeSignal    = 0x1A;
const int epcTypeSdui      = 0x1B;
const int epcTypeSecurity  = 0x1C;
const int epcTypeSystem    = 0x1D;
const int epcTypeDebug     = 0x1E;
const int epcTypeFileXfer  = 0x1F;
const int epcTypePlugin    = 0x20;
const int epcTypeUiInput   = 0x21;
const int epcTypeNetwork   = 0x22;
const int epcTypeTransport = 0x23;
const int epcTypeDb        = 0x24;
const int epcTypeBizExt    = 0xFD;
const int epcTypeExper     = 0xFE;
const int epcTypeRaw       = 0xFF;

// ─── 0x10 LLM ───
const int epcSubContent     = 0x10;
const int epcSubThinking    = 0x11;
const int epcSubToolCall    = 0x12;
const int epcSubToolResult  = 0x13;
const int epcSubError       = 0x14;
const int epcSubMeta        = 0x16;

// ─── 0x11 AGENT ───
const int epcSubAgentState    = 0x20;
const int epcSubTaskStart     = 0x21;
const int epcSubTaskProgress  = 0x22;
const int epcSubTaskDone      = 0x23;
const int epcSubSpawn         = 0x24;
const int epcSubJoin          = 0x25;
const int epcSubMemRead       = 0x26;
const int epcSubMemWrite      = 0x27;
const int epcSubSessionEvent  = 0x28;

// ─── 0x12 MEDIA (audio + video) ───
const int epcSubLmdn       = 0x30;
const int epcSubOpus       = 0x31;
const int epcSubPcm        = 0x32;
const int epcSubVad        = 0x33;
const int epcSubRecStart   = 0x38;
const int epcSubRecStop    = 0x39;
const int epcSubPlayStart  = 0x3A;
const int epcSubPlayStop   = 0x3B;
const int epcSubH264       = 0x50;
const int epcSubMediaMeta  = 0x52;

// ─── 0x13 IMAGE ───
const int epcSubImgRaw     = 0x40;
const int epcSubImgUrl     = 0x41;
const int epcSubImgMeta    = 0x42;
const int epcSubImgGen     = 0x43;
const int epcSubImgAnalyze = 0x44;

// ─── 0x14 FS ───
const int epcSubFsLs       = 0x70;
const int epcSubFsDir      = 0x71;
const int epcSubFsCat      = 0x72;
const int epcSubFsRead     = 0x73;
const int epcSubFsWrite    = 0x74;
const int epcSubFsAppend   = 0x75;
const int epcSubFsDelete   = 0x76;
const int epcSubFsCopy     = 0x77;
const int epcSubFsMove     = 0x78;
const int epcSubFsMkdir    = 0x79;
const int epcSubFsRmdir    = 0x7A;
const int epcSubFsStat     = 0x7B;
const int epcSubFsChmod    = 0x7C;
const int epcSubFsExists   = 0x7D;
const int epcSubFsTree     = 0x7E;
const int epcSubFsGlob     = 0x7F;

// ─── 0x17 CHAT ───
const int epcSubChatMsg      = 0xF0;
const int epcSubChatTyping   = 0xF1;
const int epcSubChatReaction = 0xF2;
const int epcSubChatAttach   = 0xF3;
const int epcSubChatQuote    = 0xF4;
const int epcSubChatDelete   = 0xF5;
const int epcSubChatEdit     = 0xF6;
const int epcSubChatReceipt  = 0xF7;
const int epcSubChatHistory  = 0xF8;

// ─── 0x18 ROOM ───
const int epcSubRoomCreate     = 0xE0;
const int epcSubRoomJoin       = 0xE1;
const int epcSubRoomLeave      = 0xE2;
const int epcSubRoomMembers    = 0xE3;
const int epcSubRoomMemberIn   = 0xE4;
const int epcSubRoomMemberOut  = 0xE5;
const int epcSubRoomMemberMute = 0xE6;
const int epcSubRoomSettings   = 0xE7;
const int epcSubRoomInvite     = 0xE8;

// ─── 0x19 CALL ───
const int epcSubCallIn      = 0xD0;
const int epcSubCallOut     = 0xD1;
const int epcSubCallAccept  = 0xD2;
const int epcSubCallReject  = 0xD3;
const int epcSubCallEnd     = 0xD4;
const int epcSubCallMute    = 0xD5;
const int epcSubCallUnmute  = 0xD6;
const int epcSubCallSpeaker = 0xD7;
const int epcSubCallVolume  = 0xD8;

// ─── 0x1A SIGNAL ───
const int epcSubSigOffer    = 0xC0;
const int epcSubSigAnswer   = 0xC1;
const int epcSubSigIce      = 0xC2;
const int epcSubSigPing     = 0xC3;
const int epcSubSigPong     = 0xC4;
const int epcSubSigPresence = 0xC5;
const int epcSubSigPeers    = 0xC6;

// ─── 0x1B SDUI ───
const int epcSubSduiTree    = 0xB0;
const int epcSubSduiDiff    = 0xB1;
const int epcSubSduiNav     = 0xB2;
const int epcSubSduiModal   = 0xB3;
const int epcSubSduiToast   = 0xB4;
const int epcSubSduiSnack   = 0xB5;
const int epcSubSduiDialog  = 0xB6;
const int epcSubSduiRefresh = 0xB7;
const int epcSubSduiTheme   = 0xB8;
const int epcSubSduiLayout  = 0xB9;
const int epcSubSduiInput   = 0xBA;
const int epcSubSduiState   = 0xBB;

// ─── 0x1C SECURITY ───
const int epcSubSecPubkey    = 0x00;
const int epcSubSecEnvelope  = 0x01;
const int epcSubSecSign      = 0x02;
const int epcSubSecAuth      = 0x03;
const int epcSubSecChallenge = 0x04;
const int epcSubSecSession   = 0x05;
const int epcSubSecPerm      = 0x06;

// ─── 0x1D SYSTEM ───
const int epcSubSysLog      = 0x10;
const int epcSubSysMetric   = 0x11;
const int epcSubSysConfig   = 0x12;
const int epcSubSysAlert    = 0x13;
const int epcSubSysHealth   = 0x14;
const int epcSubSysVersion  = 0x15;
const int epcSubSysStatus   = 0x16;
const int epcSubSysErrLog   = 0x17;
const int epcSubSysWarn     = 0x18;
const int epcSubSysInfo     = 0x19;
const int epcSubSysDebug    = 0x1A;

// ─── 0x1E DEBUG ───
const int epcSubDbgTrace    = 0x20;
const int epcSubDbgInspect  = 0x21;
const int epcSubDbgProfile  = 0x22;
const int epcSubDbgBreak    = 0x23;
const int epcSubDbgWatch    = 0x24;
const int epcSubDbgStack    = 0x25;
const int epcSubDbgHeap     = 0x26;
const int epcSubDbgMemDump  = 0x27;

// ─── 0x1F FILE_XFER ───
const int epcSubFileBlob    = 0x60;
const int epcSubFileMeta    = 0x61;
const int epcSubFileChunk   = 0x62;
const int epcSubFileXferStart = 0x63;
const int epcSubFileXferDone  = 0x64;
const int epcSubFileXferCancel = 0x65;

// ─── 0x20 PLUGIN ───
const int epcSubPluginLoad     = 0x60;
const int epcSubPluginUnload   = 0x61;
const int epcSubPluginEvent    = 0x62;
const int epcSubPluginRegTool  = 0x63;
const int epcSubPluginExecTool = 0x64;
const int epcSubPluginResult   = 0x65;

// ─── 0x21 UI_INPUT ───
const int epcSubUiKeyDown   = 0x50;
const int epcSubUiKeyUp     = 0x51;
const int epcSubUiMouseMove = 0x52;
const int epcSubUiMouseDown = 0x53;
const int epcSubUiMouseUp   = 0x54;
const int epcSubUiScroll    = 0x55;
const int epcSubUiTouch     = 0x56;
const int epcSubUiGesture   = 0x57;
const int epcSubUiClipboard = 0x58;
const int epcSubUiDrag      = 0x59;
const int epcSubUiDrop      = 0x5A;

// ─── 0x22 NETWORK ───
const int epcSubNetDisc     = 0x30;
const int epcSubNetRoute    = 0x31;
const int epcSubNetSync     = 0x32;
const int epcSubNetGossip   = 0x33;
const int epcSubNetPeer     = 0x34;
const int epcSubNetTopology = 0x35;

// ─── 0x23 TRANSPORT ───
const int epcSubTpStream    = 0x40;
const int epcSubTpAck       = 0x41;
const int epcSubTpHeartbeat = 0x42;
const int epcSubTpFlowCtl   = 0x43;
const int epcSubTpRetry     = 0x44;
const int epcSubTpBackpress = 0x45;
const int epcSubTpConnect   = 0x46;
const int epcSubTpDisconnect = 0x47;
const int epcSubTpReconnect = 0x48;

// ─── 0x24 DB ───
const int epcSubDbQuery     = 0xA0;
const int epcSubDbExec      = 0xA1;
const int epcSubDbInsert    = 0xA2;
const int epcSubDbUpdate    = 0xA3;
const int epcSubDbDelete    = 0xA4;
const int epcSubDbSchema    = 0xA5;
const int epcSubDbMigrate   = 0xA6;
const int epcSubDbIndex     = 0xA7;
const int epcSubDbTxBegin   = 0xA8;
const int epcSubDbTxCommit  = 0xA9;
const int epcSubDbTxRollback = 0xAA;
