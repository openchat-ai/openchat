/**
 * SemanticNN — 神经语义分析器 (指针网络版)
 *
 * 不预测数字值，预测数字位置。
 * 输入 "1加到100" → 标注 位置0-1是数字，位置3-5是数字 → 提取到 "1" 和 "100"
 * 字符级标注：每个字符标注为 N(数字)、O(操作符)、X(噪声) 之一
 */

export class SemanticNN {
  constructor(hiddenSize = 32) {
    this.hiddenSize = hiddenSize;
    this.charToIdx = new Map();
    this.idxToChar = new Map();

    // LSTM 权重
    this.W_i = this.U_i = this.b_i = null;
    this.W_f = this.U_f = this.b_f = null;
    this.W_c = this.U_c = this.b_c = null;
    this.W_o = this.U_o = this.b_o = null;

    // 输出层: hidden → 3类 (N数字/O操作符/X噪声) + 4类操作类型
    this.W_tag = null; this.b_tag = null;  // 标注头
    this.W_op = null; this.b_op = null;    // 操作分类头

    this.samples = 0;
    this.loss = 1.0;
  }

  _initWeights() {
    const h = this.hiddenSize, v = this.charToIdx.size;
    const s = Math.sqrt(2.0 / h);
    this.W_i=this._m(v,h,s);this.U_i=this._m(h,h,s);this.b_i=this._v(h,0);
    this.W_f=this._m(v,h,s);this.U_f=this._m(h,h,s);this.b_f=this._v(h,1);
    this.W_c=this._m(v,h,s);this.U_c=this._m(h,h,s);this.b_c=this._v(h,0);
    this.W_o=this._m(v,h,s);this.U_o=this._m(h,h,s);this.b_o=this._v(h,0);
    this.W_tag=this._m(h,3,0.01);this.b_tag=this._v(3,0);
    this.W_op=this._m(h,4,0.01);this.b_op=this._v(4,0);
  }
  _m(r,c,s){const m=[];for(let i=0;i<r;i++){m[i]=[];for(let j=0;j<c;j++)m[i][j]=(Math.random()*2-1)*s}return m}
  _v(n,x){return new Array(n).fill(x)}

  _sigmoid(x){return 1/(1+Math.exp(Math.max(-10,Math.min(10,-x))))}
  _softmax(a){const m=Math.max(...a);const e=a.map(x=>Math.exp(x-m));const s=e.reduce((x,y)=>x+y,0);return e.map(x=>x/s)}

  /** 确保/扩展词表 */
  _ensureVocab(text) {
    for(const ch of[...text]){if(!this.charToIdx.has(ch)){const i=this.charToIdx.size;this.charToIdx.set(ch,i);this.idxToChar.set(i,ch)}}
    if(!this.charToIdx.has('<UNK>'))this.charToIdx.set('<UNK>',this.charToIdx.size);
    if(!this.W_i)this._initWeights();
  }

  /** 按类重置权重（保留已有权重的经验） */
  resetOutputLayer() {
    if(!this.W_tag)return;
    const h=this.hiddenSize;
    this.W_tag=this._m(h,3,0.01);this.b_tag=this._v(3,0);
    this.W_op=this._m(h,4,0.01);this.b_op=this._v(4,0);
  }

  /** LSTM 前向: 返回所有时间步的 [hidden状态, cell状态] */
  _lstmSeq(xSeq) {
    const h=this.hiddenSize,T=xSeq.length;
    const hs=[], cs=[];
    let c=new Array(h).fill(0), prevH=new Array(h).fill(0);
    for(let t=0;t<T;t++){
      const x=xSeq[t],i=new Array(h),f=new Array(h),cc=new Array(h),o=new Array(h);
      const newC=new Array(h),newH=new Array(h);
      for(let j=0;j<h;j++){
        const xi=this._d(x,this.W_i,j), hi=this._d(prevH,this.U_i,j);
        i[j]=this._sigmoid(xi+hi+this.b_i[j]);
        f[j]=this._sigmoid(this._d(x,this.W_f,j)+this._d(prevH,this.U_f,j)+this.b_f[j]);
        cc[j]=Math.tanh(this._d(x,this.W_c,j)+this._d(prevH,this.U_c,j)+this.b_c[j]);
        o[j]=this._sigmoid(this._d(x,this.W_o,j)+this._d(prevH,this.U_o,j)+this.b_o[j]);
        newC[j]=f[j]*c[j]+i[j]*cc[j];
        newH[j]=o[j]*Math.tanh(newC[j]);
      }
      c=newC;prevH=newH;hs.push(newH);cs.push(c);
    }
    return {hs, lastH:hs[hs.length-1]};
  }
  _d(v,m,c){let s=0;for(let i=0;i<v.length;i++)s+=(v[i]||0)*(m[i]?.[c]||0);return s}
  _dot(v,m){const r=new Array(m[0].length).fill(0);for(let j=0;j<m[0].length;j++)for(let i=0;i<v.length;i++)r[j]+=v[i]*m[i][j];return r}

  /** 文本→one-hot序列 */
  _encode(text){const r=[];for(const ch of[...text]){const oh=new Array(this.charToIdx.size).fill(0);oh[this.charToIdx.get(ch)||this.charToIdx.get('<UNK>')]=1;r.push(oh)}return r}

  /**
   * 标注文本中的数字位置
   * @returns {{ tags: string[], ops: string }}
   */
  tag(text) {
    this._ensureVocab(text);
    const chars=[...text];
    const xSeq=this._encode(text);
    const {hs} = this._lstmSeq(xSeq);
    const tags=[];

    // 在每个位置做3分类: N(数字)/O(操作符)/X(噪声)
    const tagNames=['N','O','X'];
    for(let t=0;t<chars.length;t++){
      const h=hs[t];
      const logits=[0,0,0];
      for(let j=0;j<3;j++)for(let i=0;i<this.hiddenSize;i++)logits[j]+=h[i]*this.W_tag[i][j];
      for(let j=0;j<3;j++)logits[j]+=this.b_tag[j];
      const probs=this._softmax(logits);
      const maxIdx=probs.indexOf(Math.max(...probs));
      tags.push({ch:chars[t], tag:tagNames[maxIdx], prob:probs[maxIdx]});
    }

    // 从 lastH 预测操作类型
    const lastH=hs[hs.length-1];
    const opLogits=[0,0,0,0];
    for(let j=0;j<4;j++)for(let i=0;i<this.hiddenSize;i++)opLogits[j]+=lastH[i]*this.W_op[i][j];
    for(let j=0;j<4;j++)opLogits[j]+=this.b_op[j];
    const opProbs=this._softmax(opLogits);
    const ops=['add','subtract','multiply','divide'];

    return {tags, op: ops[opProbs.indexOf(Math.max(...opProbs))], opConf: Math.max(...opProbs)};
  }

  /**
   * 从标注结果提取数字
   */
  extractNumbers(text) {
    const {tags, op} = this.tag(text);
    const numberSpans = [];
    let inNum = false, buf = '';

    for (const t of tags) {
      if (t.tag === 'N') {
        buf += t.ch;
        inNum = true;
      } else {
        if (inNum && buf) { numberSpans.push(buf); buf = ''; inNum = false; }
      }
    }
    if (inNum && buf) numberSpans.push(buf);

    const nums = numberSpans.map(s => parseInt(s)).filter(n => !isNaN(n));
    return { nums, ops: [op] };
  }

  /**
   * 训练
   * @param {string} text
   * @param {{ nums: number[], ops: string[] }} target
   */
  train(text, target) {
    this._ensureVocab(text);
    const chars = text.split('');
    const xSeq = this._encode(text);
    const {hs} = this._lstmSeq(xSeq);
    const lr = 0.003;

    // 1. 生成参考答案标注
    const refTags = this._tagReference(text, target.nums);

    // 2. 训练标注头 (每位置做3分类)
    let tagLoss = 0;
    for (let t = 0; t < chars.length; t++) {
      const h = hs[t];
      const logits = [0, 0, 0];
      for (let j = 0; j < 3; j++) for (let i = 0; i < this.hiddenSize; i++) logits[j] += h[i] * this.W_tag[i][j];
      for (let j = 0; j < 3; j++) logits[j] += this.b_tag[j];
      const probs = this._softmax(logits);
      const ref = ['N','O','X'].indexOf(refTags[t].tag);

      // SGD on tag head
      for (let j = 0; j < 3; j++) {
        const err = (j === ref ? 1 : 0) - probs[j];
        for (let i = 0; i < this.hiddenSize; i++) this.W_tag[i][j] -= lr * (-err) * h[i];
        this.b_tag[j] -= lr * (-err) * 0.1;
      }
      tagLoss += -Math.log(Math.max(probs[ref], 1e-7));
    }

    // 3. 训练操作分类头
    const lastH = hs[hs.length - 1];
    const opLogits = [0, 0, 0, 0];
    for (let j = 0; j < 4; j++) for (let i = 0; i < this.hiddenSize; i++) opLogits[j] += lastH[i] * this.W_op[i][j];
    for (let j = 0; j < 4; j++) opLogits[j] += this.b_op[j];
    const opProbs = this._softmax(opLogits);
    const opIdx = ['add','subtract','multiply','divide'].indexOf(target.ops[0] || 'add');
    const opRef = opIdx >= 0 ? opIdx : 0;
    for (let j = 0; j < 4; j++) {
      const err = (j === opRef ? 1 : 0) - opProbs[j];
      for (let i = 0; i < this.hiddenSize; i++) this.W_op[i][j] -= lr * (-err) * lastH[i];
      this.b_op[j] -= lr * (-err) * 0.1;
    }

    this.loss = (this.loss * 0.9 + tagLoss / chars.length * 0.1);
    this.samples++;
  }

  /**
   * 根据答案反推每个字符应该标注什么
   */
  _tagReference(text, nums) {
    const tags = [];
    const digits = /[0-9０-９]/;
    for (const ch of text) {
      if (digits.test(ch)) tags.push({ch, tag:'N'});
      else if (/[+\-×÷×＋➖✖➗=＝加乘除减]/.test(ch)) tags.push({ch, tag:'O'});
      else tags.push({ch, tag:'X'});
    }
    return tags;
  }

  trainBatch(pairs) { for (const [text, target] of pairs) this.train(text, target); }

  getStats() {
    const h = this.hiddenSize, v = this.charToIdx.size;
    const params = (h*v+h*h+h)*4 + h*3+3 + h*4+4;
    return { hiddenSize: h, vocabSize: v, params, samples: this.samples, loss: Number(this.loss.toFixed(4)) };
  }

  static generateData(q) {
    const t = typeof q === 'string' ? q : (q?.question || q?.id || '');
    const nums = t.match(/\d+/g)?.map(Number)||[];
    if(nums.length<2)return[];
    const p=[[t,{nums:[...nums],ops:['add']}]];
    const noises=['啊','呀','嗯','呢','就是','大概'];
    for(let i=0;i<3&&i<noises.length;i++){let n=t;const pos=Math.floor(Math.random()*n.length*.5)+Math.floor(n.length*.3);n=n.slice(0,pos)+noises[i]+n.slice(pos);p.push([n,{nums:[...nums],ops:['add']}])}
    return p;
  }
}
