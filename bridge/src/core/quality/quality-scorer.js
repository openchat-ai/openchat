/**
 * 质量评分器
 * 评估 LLM 输出质量：相关性、完整性、一致性、幻觉检测等
 */
export class QualityScorer {
  constructor(options = {}) {
    this._weights = {
      relevance: options.relevanceWeight || 0.20,
      completeness: options.completenessWeight || 0.15,
      consistency: options.consistencyWeight || 0.10,
      hallucination: options.hallucinationWeight || 0.08,
      toxicity: options.toxicityWeight || 0.08,
      faithfulness: options.faithfulnessWeight || 0.08,
      factuality: options.factualityWeight || 0.07,
      coherence: options.coherenceWeight || 0.07,
      conciseness: options.concisenessWeight || 0.05,
      readability: options.readabilityWeight || 0.05,
      sentiment: options.sentimentWeight || 0.04,
      styleConsistency: options.styleConsistencyWeight || 0.03
    };

    this._certaintyPatterns = [
      /definitely|absolutely|certainly|obviously|clearly/i,
      /always|never|every|none|all/i,
      /must be|has to be|guaranteed|100%/i,
      /proven|scientific|fact|truth/i
    ];

    this._vaguePatterns = [
      /maybe|perhaps|might|could be|possibly/i,
      /somewhat|kind of|sort of|a bit/i,
      /seems|appears|looks like/i,
      /I think|I believe|I feel/i
    ];

    this._hedgePatterns = [
      /typically|usually|often|sometimes/i,
      /generally|normally|ordinarily/i,
      /in most cases|most likely|probably/i
    ];

    this._toxicPatterns = [
      /stupid|dumb|idiot|loser/i,
      /hate|terrible|awful|worst/i,
      /moron|fool|ignorant/i,
      /you are|you're incompetent/i
    ];

    this._factClaimPatterns = [
      /\b(percent|percentage|%|rate|ratio)\b/gi,
      /\b(million|billion|trillion|thousand)\b/gi,
      /\b(always|never|every|none)\b/gi,
      /\b(first|second|third|latest|newest)\b/gi,
      /\b(best|worst|top|bottom)\b/gi
    ];

    this._positivePatterns = [
      /excellent|amazing|wonderful|fantastic|great|good|helpful/i,
      /love|like|appreciate|prefer/i,
      /correct|right|perfect|ideal/i,
      /easy|simple|clear|obvious/i,
      /success|successful|achieve|improve/i
    ];

    this._negativePatterns = [
      /terrible|awful|horrible|bad|poor|wrong/i,
      /hate|dislike|disapprove|reject/i,
      /fail|failure|wrong|mistake|error/i,
      /difficult|hard|complex|confusing|unclear/i,
      /problem|issue|bug|broken/i
    ];

    this._technicalPatterns = [
      /\b\d+\s*\(\s*\d+\s*\)/,
      /\bfunction\s*\(/,
      /\bclass\s+\w+/,
      /\bconst\s+\w+\s*=/,
      /\bvar\s+\w+\s*=/,
      /\blet\s+\w+\s*=/,
      /=>\s*{/,
      /\bif\s*\(/,
      /\bfor\s*\(/,
      /\bwhile\s*\(/,
      /\breturn\s+/,
      /\bimport\s+/,
      /\bexport\s+/,
      /\basync\s+/,
      /\bawait\s+/,
      /\btry\s*{/,
      /\bcatch\s*\(/,
      /```\w*/,
      /\{[\s\S]*?:[\s\S]*?\}/
    ];

    this._formalPatterns = [
      /\btherefore|thus|hence|consequently/i,
      /\bfurthermore|moreover|additionally|similarly/i,
      /\bhowever|nevertheless|although|whereas/i,
      /\bsubsequently|accordingly|meanwhile/i,
      /\bprimarily|essentially|fundamentally/i,
      /\bnotwithstanding|henceforth|thereby/i
    ];

    this._internalConsistencyCache = new Map();
    this._maxCacheSize = options.cacheSize || 100;
    this._scoreHistory = [];
    this._maxHistorySize = options.maxHistorySize || 1000;
    this._userStyleProfile = null;
    this._sentimentWords = new Map();
  }

  calculateOverallScore(metrics) {
    const weightedSum = 
      metrics.relevance * this._weights.relevance +
      metrics.completeness * this._weights.completeness +
      metrics.consistency * this._weights.consistency +
      metrics.hallucinationResistance * this._weights.hallucination +
      metrics.toxicity * this._weights.toxicity +
      metrics.faithfulness * (this._weights.faithfulness || 0.08) +
      metrics.factuality * (this._weights.factuality || 0.07) +
      metrics.coherence * (this._weights.coherence || 0.07) +
      metrics.conciseness * (this._weights.conciseness || 0.05) +
      metrics.readability * (this._weights.readability || 0.05) +
      metrics.sentiment * (this._weights.sentiment || 0.04) +
      metrics.styleConsistency * (this._weights.styleConsistency || 0.03);
    
    return Math.round(weightedSum * 100) / 100;
  }

  score(content, context = {}) {
    const relevance = this.scoreRelevance(content, context.query || context.prompt || '');
    const completeness = this.scoreCompleteness(content, context.requiredFields || []);
    const consistency = this.scoreConsistency(content);
    const hallucinationResistance = this.scoreHallucinationResistance(content);
    const toxicity = this.scoreToxicity(content);
    const faithfulness = this.scoreFaithfulness(content, context.source || context.context || '');
    const factuality = this.scoreFactuality(content);
    const coherence = this.scoreCoherence(content);
    const conciseness = this.scoreConciseness(content);
    const readability = this.scoreReadability(content);
    const sentiment = this.scoreSentiment(content);
    const styleConsistency = this.scoreStyleConsistency(content, context.userStyle || null);

    const overall = this.calculateOverallScore({
      relevance,
      completeness,
      consistency,
      hallucinationResistance,
      toxicity,
      faithfulness,
      factuality,
      coherence,
      conciseness,
      readability,
      sentiment,
      styleConsistency
    });

    const result = {
      overall,
      relevance,
      completeness,
      consistency,
      hallucinationResistance,
      toxicity,
      faithfulness,
      factuality,
      coherence,
      conciseness,
      readability,
      sentiment,
      styleConsistency
    };

    this._addToHistory(result, context);

    return result;
  }

  _addToHistory(score, context = {}) {
    this._scoreHistory.push({
      timestamp: Date.now(),
      overall: score.overall,
      dimensions: { ...score },
      context: context.query || context.prompt || null
    });

    if (this._scoreHistory.length > this._maxHistorySize) {
      this._scoreHistory.shift();
    }
  }

  scoreRelevance(content, query) {
    if (!query || !content) return 0.5;
    
    const queryWords = this._normalizeText(query).split(/\s+/).filter(w => w.length > 2);
    const contentWords = this._normalizeText(content);
    
    if (queryWords.length === 0) return 0.5;
    
    let matches = 0;
    for (const word of queryWords) {
      if (contentWords.includes(word)) matches++;
    }
    
    const matchRatio = matches / queryWords.length;
    
    const queryEntities = this._extractEntities(query);
    const contentEntities = this._extractEntities(content);
    let entityMatches = 0;
    for (const entity of queryEntities) {
      if (contentEntities.includes(entity)) entityMatches++;
    }
    const entityRatio = queryEntities.length > 0 ? entityMatches / queryEntities.length : 0;
    
    return Math.round((matchRatio * 0.6 + entityRatio * 0.4) * 100) / 100;
  }

  scoreCompleteness(content, requiredFields = []) {
    if (requiredFields.length === 0) {
      const stats = this._getBasicStats(content);
      if (stats.wordCount < 10) return 0.3;
      if (stats.wordCount < 30) return 0.6;
      if (stats.wordCount < 100) return 0.8;
      return 0.9;
    }

    let matched = 0;
    for (const field of requiredFields) {
      if (content.toLowerCase().includes(field.toLowerCase())) {
        matched++;
      }
    }

    return Math.round((matched / requiredFields.length) * 100) / 100;
  }

  scoreConsistency(content) {
    const contradictions = this._detectContradictions(content);
    
    if (contradictions.length === 0) return 1.0;
    
    const contradictionPenalty = Math.min(contradictions.length * 0.2, 0.8);
    return Math.max(0.1, 1 - contradictionPenalty);
  }

  scoreHallucinationResistance(content) {
    const certaintyStatements = this._findMatches(content, this._certaintyPatterns);
    const uncertainStatements = this._findMatches(content, this._vaguePatterns);
    const hedgeStatements = this._findMatches(content, this._hedgePatterns);

    const totalQualifierCount = certaintyStatements.length + uncertainStatements.length + hedgeStatements.length;
    
    if (totalQualifierCount === 0) return 0.7;
    
    const certaintyRatio = certaintyStatements.length / totalQualifierCount;
    const uncertainRatio = uncertainStatements.length / totalQualifierCount;
    const hedgeRatio = hedgeStatements.length / totalQualifierCount;

    let score = 0.5;
    score += hedgeRatio * 0.3;
    score += uncertainRatio * 0.2;
    score -= certaintyRatio * 0.4;

    const facts = this._extractFacts(content);
    const claimsWithSupport = this._evaluateClaimSupport(content, facts);
    
    if (facts.length > 0) {
      const supportRatio = claimsWithSupport / facts.length;
      score = score * 0.6 + supportRatio * 0.4;
    }

    return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
  }

  scoreToxicity(content) {
    const toxicStatements = this._findMatches(content, this._toxicPatterns);
    
    if (toxicStatements.length === 0) return 1.0;
    
    const severity = toxicStatements.length === 1 ? 0.5 : toxicStatements.length === 2 ? 0.3 : 0.1;
    return severity;
  }

  _detectContradictions(content) {
    const contradictions = [];
    const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
    
    const positiveNegative = [
      [/\b(can|cannot|could)\b/i, /\b(cannot|cannot|cannot)\b/i],
      [/\b(always)\b/i, /\b(never)\b/i],
      [/\b(all)\b/i, /\b(none|no)\b/i],
      [/\b(always)\b/i, /\b(sometimes|rarely)\b/i],
      [/\b(must)\b/i, /\b(might not|may not)\b/i],
      [/\b(everyone)\b/i, /\b(nobody|no one)\b/i]
    ];

    for (let i = 0; i < sentences.length; i++) {
      for (let j = i + 1; j < sentences.length; j++) {
        const s1 = sentences[i];
        const s2 = sentences[j];

        for (const [posPattern, negPattern] of positiveNegative) {
          const s1HasPos = posPattern.test(s1);
          const s2HasNeg = negPattern.test(s2);
          const s2HasPos = posPattern.test(s2);
          const s1HasNeg = negPattern.test(s1);

          if ((s1HasPos && s2HasNeg) || (s2HasPos && s1HasNeg)) {
            if (this._sentencesRelated(s1, s2)) {
              contradictions.push({
                sentence1: s1.substring(0, 50),
                sentence2: s2.substring(0, 50),
                type: 'contradiction'
              });
            }
          }
        }
      }
    }

    return contradictions;
  }

  _sentencesRelated(s1, s2) {
    const words1 = new Set(s1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(s2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    
    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) intersection++;
    }

    const union = words1.size + words2.size - intersection;
    const similarity = union > 0 ? intersection / union : 0;

    return similarity > 0.2;
  }

  _extractFacts(content) {
    const facts = [];
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    const factPatterns = [
      /\b(is|are|was|were)\s+[\w\s]+,\s+[\w\s]+/gi,
      /\b(\w+)\s+(is|are|was|were)\s+\w+/gi,
      /\bhas\s+\w+\s+(\w+)/gi,
      /\b(\w+)\s+contains?\s+\w+/gi
    ];

    for (const sentence of sentences) {
      for (const pattern of factPatterns) {
        const matches = sentence.match(pattern);
        if (matches) {
          facts.push(...matches);
        }
      }
    }

    return [...new Set(facts)];
  }

  _evaluateClaimSupport(content, facts) {
    if (facts.length === 0) return 0;
    
    let supported = 0;
    for (const fact of facts) {
      const surroundingContext = this._getContextAround(content, fact);
      if (this._hasSupportingEvidence(fact, surroundingContext)) {
        supported++;
      }
    }

    return supported;
  }

  _getContextAround(content, phrase, contextLength = 50) {
    const index = content.indexOf(phrase);
    if (index === -1) return '';
    
    const start = Math.max(0, index - contextLength);
    const end = Math.min(content.length, index + phrase.length + contextLength);
    return content.substring(start, end);
  }

  _hasSupportingEvidence(fact, context) {
    const supportIndicators = [
      /because|since|therefore|thus|hence/i,
      /according to|based on|study|research|data/i,
      /shows|demonstrates|indicates|suggests/i
    ];

    for (const pattern of supportIndicators) {
      if (pattern.test(context)) return true;
    }

    return fact.length > 10;
  }

  _countClaims(content) {
    const claimIndicators = [
      /\b(is|are|was|were)\b/i,
      /\b(has|have|had)\b/i,
      /\b(can|cannot|could)\b/i,
      /\b(will|would|should|may|might)\b/i,
      /\b(believes?|thinks?|knows?)\b/i
    ];

    let count = 0;
    for (const pattern of claimIndicators) {
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    }

    return count;
  }

  _getUncertainClaimRatio(content) {
    const totalClaims = this._countClaims(content);
    if (totalClaims === 0) return 0;

    const uncertainClaims = this._findMatches(content, [...this._vaguePatterns, ...this._hedgePatterns]).length;
    return Math.round((uncertainClaims / totalClaims) * 100) / 100;
  }

  _countSelfReferences(content) {
    const selfRefPatterns = [
      /\bI\s+\w+/gi,
      /\bwe\s+\w+/gi,
      /\bmy\s+\w+/gi,
      /\bour\s+\w+/gi,
      /\b(am|was)\s+(going to|going|considering)/gi
    ];

    let count = 0;
    for (const pattern of selfRefPatterns) {
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    }

    return count;
  }

  _countAnsweredQuestions(content, query) {
    if (!query.includes('?')) return -1;

    const questions = query.split('?').filter(q => q.trim().length > 0);
    let answered = 0;

    for (const question of questions) {
      const keyWords = question.split(/\s+/).filter(w => w.length > 3);
      let matchCount = 0;
      for (const word of keyWords) {
        if (content.toLowerCase().includes(word.toLowerCase())) {
          matchCount++;
        }
      }
      if (matchCount >= keyWords.length * 0.3) {
        answered++;
      }
    }

    return answered;
  }

  _collectFlags(content) {
    const flags = [];

    if (this._countSelfReferences(content) > 3) {
      flags.push({ type: 'excessive_self_reference', severity: 'low' });
    }

    const contradictions = this._detectContradictions(content);
    if (contradictions.length > 0) {
      flags.push({ type: 'contradictions', severity: 'medium', count: contradictions.length });
    }

    const toxicStatements = this._findMatches(content, this._toxicPatterns);
    if (toxicStatements.length > 0) {
      flags.push({ type: 'toxicity', severity: 'high', count: toxicStatements.length });
    }

    const certaintyCount = this._findMatches(content, this._certaintyPatterns).length;
    if (certaintyCount > 5) {
      flags.push({ type: 'overly_certain', severity: 'medium' });
    }

    const stats = this._getBasicStats(content);
    if (stats.wordCount < 10 && stats.sentenceCount < 2) {
      flags.push({ type: 'too_short', severity: 'low' });
    }

    return flags;
  }

  _findMatches(content, patterns) {
    const matches = [];
    for (const pattern of patterns) {
      const found = content.match(pattern);
      if (found) {
        matches.push(...found);
      }
    }
    return matches;
  }

  _normalizeText(text) {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _extractEntities(text) {
    const entityPatterns = [
      /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g,
      /\b\d+(?:\.\d+)*(?:\s*\w+)*/g
    ];

    const entities = new Set();
    for (const pattern of entityPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(e => entities.add(e));
      }
    }

    return Array.from(entities);
  }

  scoreFaithfulness(content, source = '') {
    if (!source) {
      return 0.7;
    }

    const contentWords = this._normalizeText(content).split(/\s+/);
    const sourceWords = this._normalizeText(source).split(/\s+/);

    let matchCount = 0;
    for (const word of contentWords) {
      if (sourceWords.includes(word) && word.length > 3) {
        matchCount++;
      }
    }

    const overlapRatio = contentWords.length > 0 ? matchCount / contentWords.length : 0;
    
    const sourceEntities = this._extractEntities(source);
    const contentEntities = this._extractEntities(content);
    
    let entityMatchCount = 0;
    for (const entity of contentEntities) {
      if (sourceEntities.includes(entity)) {
        entityMatchCount++;
      }
    }
    const entityRatio = contentEntities.length > 0 ? entityMatchCount / contentEntities.length : 0;

    const score = overlapRatio * 0.6 + entityRatio * 0.4;
    return Math.round(Math.min(1, score * 1.5) * 100) / 100;
  }

  scoreFactuality(content) {
    const factClaims = this._findMatches(content, this._factClaimPatterns);
    
    if (factClaims.length === 0) {
      return 0.8;
    }

    const quantifiedStatements = factClaims.length;
    const uncertaintyIndicators = this._findMatches(content, this._vaguePatterns).length +
                                  this._findMatches(content, this._hedgePatterns).length;
    
    if (uncertaintyIndicators === 0) {
      return Math.max(0.3, 1 - quantifiedStatements * 0.1);
    }

    const balanceRatio = uncertaintyIndicators / quantifiedStatements;
    
    if (balanceRatio >= 0.5) {
      return 0.9;
    } else if (balanceRatio >= 0.3) {
      return 0.75;
    } else if (balanceRatio >= 0.1) {
      return 0.6;
    }
    
    return Math.max(0.3, 0.6 - (0.1 * (1 - balanceRatio)));
  }

  scoreCoherence(content) {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    if (sentences.length <= 1) {
      return 0.9;
    }

    let transitionCount = 0;
    const transitionWords = [
      'however', 'therefore', 'furthermore', 'moreover', 'additionally',
      'consequently', 'nevertheless', 'meanwhile', 'although', 'because',
      'since', 'while', 'whereas', 'thus', 'hence'
    ];

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      for (const tw of transitionWords) {
        if (lower.includes(tw)) {
          transitionCount++;
          break;
        }
      }
    }

    const transitionScore = transitionCount / sentences.length;

    let topicConsistency = 0;
    if (sentences.length >= 2) {
      const firstSentenceWords = new Set(sentences[0].toLowerCase().split(/\s+/).filter(w => w.length > 4));
      
      for (let i = 1; i < sentences.length; i++) {
        const currentWords = new Set(sentences[i].toLowerCase().split(/\s+/).filter(w => w.length > 4));
        let intersection = 0;
        for (const word of firstSentenceWords) {
          if (currentWords.has(word)) intersection++;
        }
        topicConsistency += intersection / firstSentenceWords.size;
      }
      topicConsistency /= (sentences.length - 1);
    }

    const score = transitionScore * 0.4 + topicConsistency * 0.6;
    return Math.round(Math.min(1, score * 1.3) * 100) / 100;
  }

  scoreConciseness(content) {
    const stats = this._getBasicStats(content);
    
    const idealWordsPerSentence = 15;
    const actualWordsPerSentence = stats.wordCount / Math.max(1, stats.sentenceCount);
    const efficiencyRatio = actualWordsPerSentence / idealWordsPerSentence;

    let conciseness = 0.5;
    if (efficiencyRatio >= 0.8 && efficiencyRatio <= 1.5) {
      conciseness = 1.0;
    } else if (efficiencyRatio >= 0.5 && efficiencyRatio <= 2.0) {
      conciseness = 0.8;
    } else if (efficiencyRatio >= 0.3 && efficiencyRatio <= 3.0) {
      conciseness = 0.6;
    } else if (efficiencyRatio < 0.3) {
      conciseness = 0.4;
    } else {
      conciseness = 0.4;
    }

    const fillerPatterns = [
      /basically|essentially|literally|actually|really|very|quite|pretty\s+/gi,
      /\bthat is to say\b|\bin other words\b|\bto put it simply\b/gi
    ];
    
    let fillerCount = 0;
    for (const pattern of fillerPatterns) {
      const matches = content.match(pattern);
      if (matches) fillerCount += matches.length;
    }

    const fillerPenalty = Math.min(0.3, fillerCount * 0.05);
    conciseness = Math.max(0.1, conciseness - fillerPenalty);

    return Math.round(conciseness * 100) / 100;
  }

  scoreReadability(content) {
    const stats = this._getBasicStats(content);
    const words = content.split(/\s+/);
    const sentences = stats.sentenceCount;
    const syllables = words.reduce((sum, w) => sum + this._countSyllables(w), 0);
    const complexWords = words.filter(w => this._countSyllables(w) >= 3).length;
    
    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / Math.max(1, words.length);
    const avgSentenceLength = stats.wordCount / Math.max(1, sentences);
    const avgSyllablesPerWord = syllables / Math.max(1, words.length);
    const percentComplexWords = (complexWords / Math.max(1, words.length)) * 100;

    const fleschScore = 206.835 - (1.015 * avgSentenceLength) - (84.6 * avgSyllablesPerWord);
    const fleschKincaid = (0.39 * avgSentenceLength) + (11.8 * avgSyllablesPerWord) - 15.59;
    const smogIndex = 1.0430 * Math.sqrt(complexWords * (30 / Math.max(1, sentences))) + 3.1291;
    const fogIndex = 0.4 * (avgSentenceLength + percentComplexWords);
    const ari = (4.71 * avgWordLength) + (0.5 * avgSentenceLength) - 21.43;
    const colemanLiau = (5.89 * avgWordLength / 100) - (30 * sentences / Math.max(1, words.length)) - 15.8;

    const normalizedFlesch = Math.max(0, Math.min(100, fleschScore)) / 100;
    const fleschGrade = Math.max(0, Math.min(18, fleschKincaid));
    const smogGrade = Math.max(0, Math.min(18, smogIndex));
    const fogGrade = Math.max(0, Math.min(20, fogIndex));
    const ariGrade = Math.max(0, Math.min(18, ari));
    const colemanGrade = Math.max(0, Math.min(18, colemanLiau));

    const avgGradeLevel = (fleschGrade + smogGrade + fogGrade + ariGrade + colemanGrade) / 5;
    const gradeConsistency = 1 - (Math.max(fleschGrade, smogGrade, fogGrade, ariGrade, colemanGrade) - 
      Math.min(fleschGrade, smogGrade, fogGrade, ariGrade, colemanGrade)) / 10;

    const industryLevels = {
      '大众读物': { min: 0, max: 6 },
      '技术文档': { min: 8, max: 12 },
      '学术论文': { min: 12, max: 18 },
      '法律文书': { min: 15, max: 22 }
    };

    let bestIndustry = '通用';
    let industryMatch = 0;
    for (const [name, range] of Object.entries(industryLevels)) {
      if (avgGradeLevel >= range.min && avgGradeLevel <= range.max) {
        bestIndustry = name;
        industryMatch = 1;
        break;
      } else {
        const dist = Math.min(Math.abs(avgGradeLevel - range.min), Math.abs(avgGradeLevel - range.max));
        const match = Math.max(0, 1 - dist / 5);
        if (match > industryMatch) {
          industryMatch = match;
          bestIndustry = name;
        }
      }
    }

    const technicalDensity = this._countMatches(content, this._technicalPatterns) / Math.max(1, words.length / 50);
    const formalDensity = this._countMatches(content, this._formalPatterns) / Math.max(1, words.length / 100);
    const codeBlockCount = (content.match(/```[\s\S]*?```/g) || []).length;
    const urlCount = (content.match(/https?:\/\/[^\s]+/g) || []).length;

    const technicalScore = Math.min(1, technicalDensity * 2) * 0.7 + Math.min(1, codeBlockCount / 5) * 0.3;
    const formalScore = Math.min(1, formalDensity * 3);

    let readabilityLevel = 'simple';
    if (avgGradeLevel >= 13) readabilityLevel = 'academic';
    else if (avgGradeLevel >= 9) readabilityLevel = 'intermediate';
    else if (avgGradeLevel >= 6) readabilityLevel = 'standard';
    else if (avgGradeLevel >= 3) readabilityLevel = 'basic';

    const overallScore = (
      normalizedFlesch * 0.25 +
      gradeConsistency * 0.25 +
      technicalScore * 0.25 +
      formalScore * 0.15 +
      industryMatch * 0.1
    );

    return {
      score: Math.round(overallScore * 100) / 100,
      formulas: {
        flesch: Math.round(fleschScore * 100) / 100,
        fleschKincaid: Math.round(fleschGrade * 100) / 100,
        smog: Math.round(smogGrade * 100) / 100,
        fog: Math.round(fogGrade * 100) / 100,
        ari: Math.round(ariGrade * 100) / 100,
        colemanLiau: Math.round(colemanGrade * 100) / 100
      },
      averageGradeLevel: Math.round(avgGradeLevel * 100) / 100,
      gradeConsistency: Math.round(gradeConsistency * 100) / 100,
      readabilityLevel,
      recommendedAudience: this._getRecommendedAudience(avgGradeLevel),
      technicalScore: Math.round(technicalScore * 100) / 100,
      formalScore: Math.round(formalScore * 100) / 100,
      bestIndustryMatch: bestIndustry,
      wordStats: {
        totalWords: words.length,
        avgWordLength: Math.round(avgWordLength * 100) / 100,
        complexWords,
        percentComplex: Math.round(percentComplexWords * 100) / 100
      },
      sentenceStats: {
        totalSentences: sentences,
        avgWordsPerSentence: Math.round(avgSentenceLength * 100) / 100
      }
    };
  }

  _getRecommendedAudience(gradeLevel) {
    if (gradeLevel < 6) return 'General public, children';
    if (gradeLevel < 9) return 'Average adult, students';
    if (gradeLevel < 12) return 'Educated professionals';
    if (gradeLevel < 15) return 'Academic audience, specialists';
    return 'Expert audience, graduate level';
  }

  _countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  _countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  _countMatches(content, patterns) {
    let count = 0;
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    }
    return count;
  }

  scoreSentiment(content) {
    const aspectPatterns = {
      quality: /(quality|perform|accuracy|reliable|fast|slow|efficien)/i,
      usability: /(easy|simple|intuitive|convenient|difficult|confus)/i,
      value: /(worth|price|cost|expensive|cheap|value|bargain)/i,
      support: /(support|service|help|responsive|team|response)/i,
      overall: /(overall|total|average|general|recommend)/i
    };

    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const aspectSentiments = {};
    let overallPositive = 0;
    let overallNegative = 0;
    let overallNeutral = 0;

    for (const [aspect, pattern] of Object.entries(aspectPatterns)) {
      const aspectSentences = sentences.filter(s => pattern.test(s));
      const posCount = this._countMatchesInSentences(aspectSentences, this._positivePatterns);
      const negCount = this._countMatchesInSentences(aspectSentences, this._negativePatterns);
      const total = posCount + negCount;

      if (total === 0) {
        aspectSentiments[aspect] = { score: 0.5, label: 'neutral', positive: 0, negative: 0, confidence: 0 };
      } else {
        const ratio = (posCount - negCount) / total;
        const confidence = Math.min(1, total / 3);
        aspectSentiments[aspect] = {
          score: Math.round((0.5 + ratio * 0.5) * 100) / 100,
          label: ratio > 0.2 ? 'positive' : ratio < -0.2 ? 'negative' : 'neutral',
          positive: posCount,
          negative: negCount,
          confidence: Math.round(confidence * 100) / 100
        };
      }

      if (aspect !== 'overall') {
        if (aspectSentiments[aspect].label === 'positive') overallPositive++;
        else if (aspectSentiments[aspect].label === 'negative') overallNegative++;
        else overallNeutral++;
      }
    }

    const emotionPatterns = {
      joy: /\b(happy|excited|delighted|pleased|thrilled|glad|joy|love|fantastic|wonderful)\b/i,
      anger: /\b(angry|furious|irritated|frustrated|annoyed|upset|rage|hate)\b/i,
      fear: /\b(afraid|scared|worried|anxious|nervous|terrified|panic|fear)\b/i,
      surprise: /\b(surprised|amazed|astonished|shocked|unexpected|stunned)\b/i,
      sadness: /\b(sad|depressed|disappointed|unhappy|miserable|sorry|grief|sorrow)\b/i
    };

    const emotions = {};
    let dominantEmotion = null;
    let maxEmotionCount = 0;

    for (const [emotion, pattern] of Object.entries(emotionPatterns)) {
      const matches = content.match(pattern);
      emotions[emotion] = { count: matches ? matches.length : 0 };
      if (emotions[emotion].count > maxEmotionCount) {
        maxEmotionCount = emotions[emotion].count;
        dominantEmotion = emotion;
      }
    }

    const totalPositive = this._countMatches(content, this._positivePatterns);
    const totalNegative = this._countMatches(content, this._negativePatterns);
    const totalSentiment = totalPositive + totalNegative;

    let sentimentScore = 0.5;
    let sentimentLabel = 'neutral';
    let sentimentIntensity = 0;

    if (totalSentiment > 0) {
      const rawScore = (totalPositive - totalNegative) / totalSentiment;
      sentimentScore = 0.5 + rawScore * 0.5;
      sentimentIntensity = Math.min(1, totalSentiment / 20);
      
      if (rawScore > 0.2) sentimentLabel = 'positive';
      else if (rawScore < -0.2) sentimentLabel = 'negative';
    }

    const subjectivity = totalSentiment / Math.max(1, content.split(/\s+/).length);
    const subjectivityScore = Math.min(1, subjectivity * 10);

    const negationPatterns = [/\bnot\b|\bno\b|\bnever\b|\bneither\b|\bwithout\b|\bdon't\b|\bdidn't\b|\bwon't\b|\bisn't\b|\baren't\b|\bwasn't\b|\baren't\b/gi];
    const negationCount = this._countMatches(content, negationPatterns);
    const negationEffect = Math.min(0.2, negationCount * 0.02);

    const intensifiedPatterns = [/\bvery\b|\breally\b|\babsolutely\b|\btotally\b|\bcompletely\b|\bextremely\b/gi];
    const intensifierCount = this._countMatches(content, intensifiedPatterns);
    const intensifierEffect = Math.min(0.15, intensifierCount * 0.03);

    const finalScore = Math.max(0, Math.min(1, sentimentScore - negationEffect + intensifierEffect));

    const polarityShift = this._detectPolarityShifts(sentences);

    return {
      score: Math.round(finalScore * 100) / 100,
      label: sentimentLabel,
      intensity: Math.round(sentimentIntensity * 100) / 100,
      subjectivity: Math.round(subjectivityScore * 100) / 100,
      aspects: aspectSentiments,
      emotions: {
        ...emotions,
        dominant: dominantEmotion,
        diversity: Object.values(emotions).filter(e => e.count > 0).length
      },
      modifiers: {
        negationCount,
        intensifierCount,
        negationEffect: Math.round(negationEffect * 100) / 100,
        intensifierEffect: Math.round(intensifierEffect * 100) / 100
      },
      polarityShifts: polarityShift,
      raw: {
        positive: totalPositive,
        negative: totalNegative,
        total: totalSentiment,
        netScore: Math.round((totalPositive - totalNegative) * 100) / 100
      },
      confidence: Math.round(Math.min(1, totalSentiment / 10) * 100) / 100
    };
  }

  _countMatchesInSentences(sentences, patterns) {
    let count = 0;
    for (const sentence of sentences) {
      for (const pattern of patterns) {
        const matches = sentence.match(pattern);
        if (matches) count += matches.length;
      }
    }
    return count;
  }

  _detectPolarityShifts(sentences) {
    const shifts = [];
    let lastPolarity = 0;

    for (let i = 0; i < sentences.length; i++) {
      const pos = this._countMatchesInSentences([sentences[i]], this._positivePatterns);
      const neg = this._countMatchesInSentences([sentences[i]], this._negativePatterns);
      const total = pos + neg;

      if (total === 0) continue;

      const polarity = (pos - neg) / total;

      if (lastPolarity !== 0 && polarity !== 0 && Math.sign(polarity) !== Math.sign(lastPolarity)) {
        shifts.push({
          sentenceIndex: i,
          from: lastPolarity > 0 ? 'positive' : 'negative',
          to: polarity > 0 ? 'positive' : 'negative',
          context: sentences[i].substring(0, 50)
        });
      }

      lastPolarity = polarity;
    }

    return {
      count: shifts.length,
      locations: shifts,
      hasShifts: shifts.length > 0
    };
  }

  buildUserStyleProfile(samples) {
    if (!Array.isArray(samples)) samples = [samples];
    const profiles = samples.map(sample => this._analyzeStyle(sample));
    
    this._userStyleProfile = {
      avgSentenceLength: profiles.reduce((sum, p) => sum + p.avgSentenceLength, 0) / profiles.length,
      avgWordLength: profiles.reduce((sum, p) => sum + p.avgWordLength, 0) / profiles.length,
      formalityLevel: profiles.reduce((sum, p) => sum + p.formalityLevel, 0) / profiles.length,
      technicalLevel: profiles.reduce((sum, p) => sum + p.technicalLevel, 0) / profiles.length
    };

    return this._userStyleProfile;
  }

  _analyzeStyle(text) {
    const words = text.split(/\s+/);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return {
      avgSentenceLength: words.length / Math.max(1, sentences.length),
      avgWordLength: words.reduce((sum, w) => sum + w.length, 0) / Math.max(1, words.length),
      formalityLevel: Math.min(1, this._countMatches(text, this._formalPatterns) / Math.max(1, words.length / 10)),
      technicalLevel: Math.min(1, this._countMatches(text, this._technicalPatterns) / Math.max(1, words.length / 10))
    };
  }

  scoreStyleConsistency(content, userStyle = null) {
    const targetProfile = userStyle || this._userStyleProfile;
    
    if (!targetProfile) {
      return { score: 0.7, consistency: 'unknown', message: 'No user style profile available' };
    }

    const contentStyle = this._analyzeStyleAdvanced(content);

    const sentenceLengthDiff = Math.abs(contentStyle.avgSentenceLength - targetProfile.avgSentenceLength) / Math.max(1, targetProfile.avgSentenceLength);
    const wordLengthDiff = Math.abs(contentStyle.avgWordLength - targetProfile.avgWordLength) / Math.max(1, targetProfile.avgWordLength);
    const formalityDiff = Math.abs(contentStyle.formalityLevel - targetProfile.formalityLevel);
    const technicalDiff = Math.abs(contentStyle.technicalLevel - targetProfile.technicalLevel);
    const punctuationDiff = Math.abs(contentStyle.punctuationDensity - targetProfile.punctuationDensity) / Math.max(0.01, targetProfile.punctuationDensity);
    const questionDiff = Math.abs(contentStyle.questionFrequency - targetProfile.questionFrequency) / Math.max(0.01, targetProfile.questionFrequency);

    const vocabularyOverlap = this._calculateVocabularyOverlap(
      contentStyle.uniqueWords || new Set(content.split(/\s+/)),
      targetProfile.uniqueWords || new Set()
    );

    const sentenceStructureDiff = this._calculateSentenceStructureDiff(contentStyle.sentencePatterns, targetProfile.sentencePatterns);

    const punctuationPatternsDiff = this._calculatePunctuationDiff(contentStyle.punctuationPatterns, targetProfile.punctuationPatterns);

    const dimensionScores = {
      sentenceLength: Math.max(0, 1 - sentenceLengthDiff),
      wordLength: Math.max(0, 1 - wordLengthDiff * 2),
      formality: Math.max(0, 1 - formalityDiff * 2),
      technical: Math.max(0, 1 - technicalDiff * 2),
      vocabulary: vocabularyOverlap,
      sentenceStructure: sentenceStructureDiff,
      punctuation: Math.max(0, 1 - punctuationPatternsDiff * 3)
    };

    const weights = {
      sentenceLength: 0.15,
      wordLength: 0.10,
      formality: 0.15,
      technical: 0.15,
      vocabulary: 0.20,
      sentenceStructure: 0.15,
      punctuation: 0.10
    };

    const weightedScore = Object.entries(dimensionScores).reduce(
      (sum, [dim, score]) => sum + score * weights[dim],
      0
    );

    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    const overallScore = weightedScore / totalWeight;

    let consistency = 'low';
    if (overallScore >= 0.75) consistency = 'high';
    else if (overallScore >= 0.5) consistency = 'medium';

    const styleDeviations = Object.entries(dimensionScores)
      .filter(([_, score]) => score < 0.6)
      .map(([dim, score]) => ({ dimension: dim, deviation: Math.round((1 - score) * 100) }));

    return {
      score: Math.round(overallScore * 100) / 100,
      consistency,
      dimensionScores: Object.fromEntries(
        Object.entries(dimensionScores).map(([k, v]) => [k, Math.round(v * 100) / 100])
      ),
      styleDeviations,
      targetProfile,
      contentProfile: {
        avgSentenceLength: Math.round(contentStyle.avgSentenceLength * 100) / 100,
        avgWordLength: Math.round(contentStyle.avgWordLength * 100) / 100,
        formalityLevel: Math.round(contentStyle.formalityLevel * 100) / 100,
        technicalLevel: Math.round(contentStyle.technicalLevel * 100) / 100,
        vocabularyRichness: Math.round(contentStyle.vocabularyRichness * 100) / 100
      },
      recommendations: this._generateStyleRecommendations(dimensionScores, targetProfile)
    };
  }

  _analyzeStyleAdvanced(text) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    
    const wordLengths = words.map(w => w.length);
    const sentenceLengths = sentences.map(s => s.split(/\s+/).length);
    
    const vocabularyRichness = uniqueWords.size / Math.max(1, words.length);
    
    const punctuationPatterns = {
      comma: (text.match(/,/g) || []).length,
      semicolon: (text.match(/;/g) || []).length,
      colon: (text.match(/:/g) || []).length,
      dash: (text.match(/-/g) || []).length,
      quotes: (text.match(/["']/g) || []).length,
      parentheses: (text.match(/[()]/g) || []).length
    };
    
    const totalPunctuation = Object.values(punctuationPatterns).reduce((a, b) => a + b, 0);
    
    const sentencePatterns = {
      simple: sentences.filter(s => !s.includes(',') && s.split(/\s+/).length < 15).length,
      complex: sentences.filter(s => s.includes(',') || s.split(/\s+/).length >= 20).length,
      compound: sentences.filter(s => /\b(and|but|or|however|therefore)\b/i.test(s)).length
    };
    
    const sentenceTypeDistribution = {
      declarative: (text.match(/\.\s+[A-Z]/g) || []).length,
      interrogative: (text.match(/\?\s*[A-Z]/g) || []).length,
      exclamatory: (text.match(/!\s*[A-Z]/g) || []).length
    };

    return {
      avgSentenceLength: words.length / Math.max(1, sentences.length),
      avgWordLength: wordLengths.reduce((a, b) => a + b, 0) / Math.max(1, wordLengths.length),
      formalityLevel: Math.min(1, this._countMatches(text, this._formalPatterns) / Math.max(1, words.length / 10)),
      technicalLevel: Math.min(1, this._countMatches(text, this._technicalPatterns) / Math.max(1, words.length / 10)),
      punctuationDensity: totalPunctuation / Math.max(1, text.length),
      questionFrequency: (text.match(/\?/g) || []).length / Math.max(1, sentences.length),
      vocabularyRichness,
      uniqueWords,
      punctuationPatterns,
      sentencePatterns,
      sentenceTypeDistribution,
      sentenceLengthVariance: this._calculateVariance(sentenceLengths),
      wordLengthVariance: this._calculateVariance(wordLengths)
    };
  }

  _calculateVariance(values) {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  _calculateVocabularyOverlap(words1, words2) {
    if (words1.size === 0 || words2.size === 0) return 0.5;
    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) intersection++;
    }
    const union = words1.size + words2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  _calculateSentenceStructureDiff(patterns1, patterns2) {
    const total1 = Object.values(patterns1).reduce((a, b) => a + b, 0) || 1;
    const total2 = Object.values(patterns2).reduce((a, b) => a + b, 0) || 1;
    
    let diff = 0;
    for (const key of new Set([...Object.keys(patterns1), ...Object.keys(patterns2)])) {
      const v1 = (patterns1[key] || 0) / total1;
      const v2 = (patterns2[key] || 0) / total2;
      diff += Math.abs(v1 - v2);
    }
    return Math.max(0, 1 - diff / 2);
  }

  _calculatePunctuationDiff(patterns1, patterns2) {
    const total1 = Object.values(patterns1).reduce((a, b) => a + b, 0) || 1;
    const total2 = Object.values(patterns2).reduce((a, b) => a + b, 0) || 1;
    
    let diff = 0;
    for (const key of new Set([...Object.keys(patterns1), ...Object.keys(patterns2)])) {
      const v1 = (patterns1[key] || 0) / total1;
      const v2 = (patterns2[key] || 0) / total2;
      diff += Math.abs(v1 - v2);
    }
    return Math.max(0, 1 - diff / 2);
  }

  _generateStyleRecommendations(dimensionScores, targetProfile) {
    const recommendations = [];
    
    if (dimensionScores.vocabulary < 0.6) {
      recommendations.push('Use more varied vocabulary to match writing style');
    }
    if (dimensionScores.sentenceLength < 0.6) {
      recommendations.push('Adjust sentence length to better match target style');
    }
    if (dimensionScores.formality < 0.6) {
      recommendations.push('Match the formality level of the target style');
    }
    if (dimensionScores.punctuation < 0.6) {
      recommendations.push('Adjust punctuation patterns to match target style');
    }
    
    return recommendations;
  }

  getScoreTrend(windowSize = 10) {
    if (this._scoreHistory.length < 2) {
      return { trend: 'insufficient_data', samples: this._scoreHistory.length };
    }

    const recent = this._scoreHistory.slice(-windowSize);
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));

    const firstAvg = firstHalf.reduce((sum, s) => sum + s.overall, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, s) => sum + s.overall, 0) / secondHalf.length;

    const change = secondAvg - firstAvg;
    let trend = 'stable';
    let trendStrength = 'weak';
    
    if (change > 0.1) { trend = 'strongly_improving'; trendStrength = 'strong'; }
    else if (change > 0.05) { trend = 'improving'; trendStrength = 'moderate'; }
    else if (change < -0.1) { trend = 'strongly_declining'; trendStrength = 'strong'; }
    else if (change < -0.05) { trend = 'declining'; trendStrength = 'moderate'; }

    const volatility = this._calculateVolatility(recent.map(s => s.overall));
    const trendSignificance = this._calculateTrendSignificance(recent.map(s => s.overall));
    const seasonality = this._detectSeasonality(recent);
    const drift = this._detectDrift(recent);
    
    let prediction = null;
    if (trend !== 'stable' && trendSignificance > 0.7) {
      const slope = this._calculateSlope(recent.map(s => s.overall));
      prediction = {
        nextExpectedScore: Math.round((secondAvg + slope * 3) * 100) / 100,
        confidence: Math.round(trendSignificance * 100) / 100,
        direction: trend.includes('improving') ? 'up' : trend.includes('declining') ? 'down' : 'stable'
      };
    }

    return {
      trend,
      trendStrength,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round((change / Math.max(0.01, firstAvg)) * 100) / 100,
      samples: recent.length,
      firstHalfAvg: Math.round(firstAvg * 100) / 100,
      secondHalfAvg: Math.round(secondAvg * 100) / 100,
      volatility: Math.round(volatility * 100) / 100,
      trendSignificance: Math.round(trendSignificance * 100) / 100,
      seasonality: seasonality.detected ? { ...seasonality } : null,
      drift: drift.detected ? { ...drift } : null,
      prediction,
      summary: this._generateTrendSummary(trend, change, volatility, trendSignificance)
    };
  }

  _calculateVolatility(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(variance);
  }

  _calculateTrendSignificance(values) {
    if (values.length < 4) return 0;
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let xDenominator = 0;
    let yDenominator = 0;
    
    for (let i = 0; i < n; i++) {
      const xDiff = i - xMean;
      const yDiff = values[i] - yMean;
      numerator += xDiff * yDiff;
      xDenominator += xDiff * xDiff;
      yDenominator += yDiff * yDiff;
    }
    
    const correlation = numerator / Math.sqrt(xDenominator * yDenominator);
    return Math.abs(correlation);
  }

  _calculateSlope(values) {
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i] - yMean);
      denominator += (i - xMean) * (i - xMean);
    }
    
    return denominator !== 0 ? numerator / denominator : 0;
  }

  _detectSeasonality(recent) {
    if (recent.length < 6) return { detected: false };
    
    const values = recent.map(s => s.overall);
    const n = values.length;
    
    const autocorrelations = [];
    for (let lag = 1; lag <= Math.floor(n / 2); lag++) {
      let correlation = 0;
      for (let i = 0; i < n - lag; i++) {
        correlation += (values[i] - values[i + lag]);
      }
      autocorrelations.push({ lag, correlation: Math.abs(correlation / (n - lag)) });
    }
    
    const maxAutocorr = autocorrelations.reduce((max, a) => a.correlation > max.correlation ? a : max, { correlation: 0 });
    
    return {
      detected: maxAutocorr.correlation > 0.3,
      period: maxAutocorr.lag,
      strength: Math.min(1, maxAutocorr.correlation)
    };
  }

  _detectDrift(recent) {
    if (recent.length < 5) return { detected: false };
    
    const values = recent.map(s => s.overall);
    const windowSize = Math.floor(values.length / 2);
    
    const firstWindow = values.slice(0, windowSize);
    const secondWindow = values.slice(windowSize);
    
    const firstMean = firstWindow.reduce((a, b) => a + b, 0) / firstWindow.length;
    const secondMean = secondWindow.reduce((a, b) => a + b, 0) / secondWindow.length;
    
    const firstVariance = firstWindow.reduce((sum, v) => sum + Math.pow(v - firstMean, 2), 0) / firstWindow.length;
    const secondVariance = secondWindow.reduce((sum, v) => sum + Math.pow(v - secondMean, 2), 0) / secondWindow.length;
    
    const pooledStd = Math.sqrt((firstVariance + secondVariance) / 2);
    const effectSize = pooledStd > 0 ? Math.abs(secondMean - firstMean) / pooledStd : 0;
    
    return {
      detected: effectSize > 0.5,
      effectSize: Math.round(effectSize * 100) / 100,
      from: Math.round(firstMean * 100) / 100,
      to: Math.round(secondMean * 100) / 100,
      magnitude: effectSize > 1 ? 'large' : effectSize > 0.5 ? 'medium' : 'small'
    };
  }

  _generateTrendSummary(trend, change, volatility, significance) {
    if (trend === 'strongly_improving') {
      return `Quality is significantly improving. Consider current trajectory.`;
    }
    if (trend === 'strongly_declining') {
      return `Quality is significantly declining. Immediate attention recommended.`;
    }
    if (trend === 'improving') {
      return `Quality is gradually improving.`;
    }
    if (trend === 'declining') {
      return `Quality is gradually declining. Monitor closely.`;
    }
    if (volatility > 0.15) {
      return `Quality is stable but with high variability.`;
    }
    return `Quality is stable within normal parameters.`;
  }

  compareMultipleScores(...scores) {
    if (scores.length < 2) {
      return { error: 'At least 2 scores required for comparison' };
    }

    const dimensions = ['relevance', 'completeness', 'consistency', 'hallucinationResistance', 'toxicity', 'faithfulness', 'factuality', 'coherence', 'conciseness'];
    const result = { overall: {}, ranking: [], winner: null, statisticalTests: {} };

    scores.forEach((score, idx) => {
      result.overall[`score${idx + 1}`] = score.overall;
    });

    const sorted = Object.entries(result.overall).sort((a, b) => b[1] - a[1]);
    result.ranking = sorted.map(([key, value], idx) => ({ rank: idx + 1, key, value }));
    result.winner = sorted[0][0];

    const overallValues = scores.map(s => s.overall);
    const anovaResult = this._performANOVA(overallValues);
    result.statisticalTests.anova = anovaResult;

    if (scores.length === 2) {
      const tTestResult = this._performTTest(scores[0].overall, scores[1].overall);
      result.statisticalTests.tTest = tTestResult;
      result.statisticalTests.significantDifference = tTestResult.pValue < 0.05;
      result.statisticalTests.confidenceInterval = this._calculateConfidenceInterval(
        scores[0].overall - scores[1].overall,
        scores.length
      );
    }

    result.dimensionComparison = {};
    for (const dim of dimensions) {
      if (scores[0][dim] !== undefined) {
        const dimValues = scores.map(s => s[dim]);
        result.dimensionComparison[dim] = {
          values: dimValues.reduce((acc, v, i) => ({ ...acc, [`score${i + 1}`]: v }), {}),
          best: dimValues.indexOf(Math.max(...dimValues)),
          variance: this._calculateVariance(dimValues)
        };

        if (scores.length === 2) {
          result.dimensionComparison[dim].tTest = this._performTTest(dimValues[0], dimValues[1]);
        }
      }
    }

    const effectSizes = [];
    for (let i = 0; i < scores.length - 1; i++) {
      for (let j = i + 1; j < scores.length; j++) {
        const cohensD = this._calculateCohenD(scores[i].overall, scores[j].overall);
        effectSizes.push({
          comparison: `${i + 1} vs ${j + 1}`,
          cohenD: Math.round(cohensD * 100) / 100,
          interpretation: this._interpretCohenD(cohensD)
        });
      }
    }
    result.statisticalTests.effectSizes = effectSizes;

    return result;
  }

  _performANOVA(groups) {
    const allValues = groups.flat();
    const grandMean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
    
    let ssBetween = 0;
    let ssWithin = 0;
    
    for (const group of groups) {
      const groupMean = group.reduce((a, b) => a + b, 0) / group.length;
      ssBetween += group.length * Math.pow(groupMean - grandMean, 2);
      for (const value of group) {
        ssWithin += Math.pow(value - groupMean, 2);
      }
    }
    
    const dfBetween = groups.length - 1;
    const dfWithin = allValues.length - groups.length;
    
    const msBetween = ssBetween / dfBetween;
    const msWithin = ssWithin / dfWithin;
    
    const fStatistic = msWithin > 0 ? msBetween / msWithin : 0;
    const pValue = this._fDistributionPValue(fStatistic, dfBetween, dfWithin);
    
    return {
      fStatistic: Math.round(fStatistic * 100) / 100,
      pValue: Math.round(pValue * 1000) / 1000,
      significant: pValue < 0.05,
      effectSize: Math.round((ssBetween / (ssBetween + ssWithin)) * 100) / 100
    };
  }

  _performTTest(mean1, mean2, n1 = 1, n2 = 1) {
    const pooledStd = Math.sqrt(((n1 - 1) + (n2 - 1)) / (n1 + n2 - 2));
    const tStatistic = pooledStd > 0 ? (mean1 - mean2) / pooledStd : 0;
    const pValue = this._tDistributionPValue(Math.abs(tStatistic), n1 + n2 - 2);
    
    return {
      tStatistic: Math.round(tStatistic * 100) / 100,
      pValue: Math.round(pValue * 1000) / 1000,
      significant: pValue < 0.05,
      meanDifference: Math.round((mean1 - mean2) * 100) / 100
    };
  }

  _calculateCohenD(mean1, mean2) {
    const pooledStd = Math.sqrt(Math.pow(mean1 - 0.5, 2) + Math.pow(mean2 - 0.5, 2));
    return pooledStd > 0 ? (mean1 - mean2) / pooledStd : 0;
  }

  _interpretCohenD(d) {
    const absD = Math.abs(d);
    if (absD < 0.2) return 'negligible';
    if (absD < 0.5) return 'small';
    if (absD < 0.8) return 'medium';
    return 'large';
  }

  _calculateConfidenceInterval(difference, n, confidence = 0.95) {
    const stdError = Math.sqrt((1 / n) * 0.15);
    const zScore = confidence === 0.95 ? 1.96 : 2.576;
    const margin = zScore * stdError;
    
    return {
      lower: Math.round((difference - margin) * 100) / 100,
      upper: Math.round((difference + margin) * 100) / 100,
      confidence: confidence * 100 + '%'
    };
  }

  _tDistributionPValue(t, df) {
    const x = df / (df + t * t);
    return df > 1 ? this._betaIncomplete(df / 2, 0.5, x) : 0;
  }

  _fDistributionPValue(f, df1, df2) {
    const x = df1 * f / (df1 * f + df2);
    return this._betaIncomplete(df1 / 2, df2 / 2, x);
  }

  _betaIncomplete(a, b, x) {
    if (x < 0 || x > 1) return 0;
    if (x === 0) return 0;
    if (x === 1) return 1;
    
    const bt = Math.exp(
      this._logGamma(a + b) - this._logGamma(a) - this._logGamma(b) +
      a * Math.log(x) + b * Math.log(1 - x)
    );
    
    return bt * this._betaCF(a, b, x) / a;
  }

  _logGamma(x) {
    const coefficients = [
      76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.001208650973866179, -0.000005395239384953
    ];
    
    let y = x;
    let tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let sum = 1.000000000190015;
    
    for (let j = 0; j < 6; j++) {
      sum += coefficients[j] / ++y;
    }
    
    return -tmp + Math.log(2.5066282746310005 * sum / x);
  }

  _betaCF(a, b, x) {
    const maxIterations = 100;
    const epsilon = 1e-10;
    
    let am = 1;
    let bm = 1;
    let az = 1;
    let qab = a + b;
    let qap = a + 1;
    let qam = a - 1;
    let bz = 1 - qab * x / qap;
    
    for (let m = 1; m <= maxIterations; m++) {
      const em = m;
      const tem = em + em;
      let d = em * (b - m) * x / ((qam + tem) * (a + tem));
      const ap = az + am * d;
      const bp = bz + am * d * bz;
      const aap = ap / bp;
      const app = az / bz;
      const t = az * aap - am * app;
      const bpp = bp / bz;
      az = ap / bpp;
      bz = 1;
      am = aap;
      bm = bpp;
      
      if (Math.abs(t - bz * az) < epsilon * Math.abs(az)) {
        return az;
      }
    }
    
    return az;
  }

  analyzeScoreAnomalies(threshold = 0.15) {
    if (this._scoreHistory.length < 3) {
      return { anomalies: [], message: 'Not enough data for anomaly detection' };
    }

    const anomalies = [];
    const recent = this._scoreHistory.slice(-20);

    for (let i = 1; i < recent.length; i++) {
      const change = Math.abs(recent[i].overall - recent[i - 1].overall);
      if (change > threshold) {
        anomalies.push({
          timestamp: recent[i].timestamp,
          previousScore: recent[i - 1].overall,
          currentScore: recent[i].overall,
          change: Math.round(change * 100) / 100,
          severity: change > 0.3 ? 'high' : 'medium'
        });
      }
    }

    return {
      anomalies,
      anomalyRate: Math.round((anomalies.length / recent.length) * 100) / 100,
      avgScore: Math.round(recent.reduce((sum, s) => sum + s.overall, 0) / recent.length * 100) / 100
    };
  }

  compareScores(scoreA, scoreB) {
    const dimensions = ['relevance', 'completeness', 'consistency', 'hallucinationResistance', 'toxicity', 'faithfulness', 'factuality', 'coherence', 'conciseness', 'readability', 'sentiment', 'styleConsistency'];
    
    const comparison = {
      overall: { A: scoreA.overall, B: scoreB.overall, winner: scoreA.overall > scoreB.overall ? 'A' : 'B' },
      dimensions: {}
    };

    for (const dim of dimensions) {
      if (scoreA[dim] !== undefined && scoreB[dim] !== undefined) {
        const diff = scoreA[dim] - scoreB[dim];
        comparison.dimensions[dim] = {
          A: scoreA[dim],
          B: scoreB[dim],
          diff: Math.round(diff * 100) / 100,
          winner: diff > 0 ? 'A' : diff < 0 ? 'B' : 'tie'
        };
      }
    }

    const aWins = Object.values(comparison.dimensions).filter(d => d.winner === 'A').length;
    const bWins = Object.values(comparison.dimensions).filter(d => d.winner === 'B').length;
    comparison.dimensionWinner = aWins > bWins ? 'A' : bWins > aWins ? 'B' : 'tie';

    return comparison;
  }

  getQualityReport(content, context = {}) {
    const score = this.score(content, context);
    
    const thresholds = {
      excellent: 0.85,
      good: 0.7,
      acceptable: 0.5,
      poor: 0.3
    };

    let quality = 'poor';
    if (score.overall >= thresholds.excellent) quality = 'excellent';
    else if (score.overall >= thresholds.good) quality = 'good';
    else if (score.overall >= thresholds.acceptable) quality = 'acceptable';

    const strengths = [];
    const weaknesses = [];

    const dimensionThresholds = {
      relevance: 0.7,
      completeness: 0.7,
      consistency: 0.8,
      hallucinationResistance: 0.7,
      toxicity: 0.8,
      faithfulness: 0.6,
      factuality: 0.6,
      coherence: 0.6,
      conciseness: 0.5,
      readability: 0.5,
      sentiment: 0.5,
      styleConsistency: 0.5
    };

    for (const [dim, threshold] of Object.entries(dimensionThresholds)) {
      if (score[dim] && score[dim].score !== undefined) {
        if (score[dim].score >= threshold) {
          strengths.push({ dimension: dim, score: score[dim].score });
        } else {
          weaknesses.push({ dimension: dim, score: score[dim].score, below: threshold - score[dim].score });
        }
      } else if (score[dim] !== undefined && typeof score[dim] === 'number') {
        if (score[dim] >= threshold) {
          strengths.push({ dimension: dim, score: score[dim] });
        } else {
          weaknesses.push({ dimension: dim, score: score[dim], below: threshold - score[dim] });
        }
      }
    }

    const improvementSuggestions = weaknesses.map(w => {
      const suggestions = {
        relevance: 'Include more keywords from the query',
        completeness: 'Add more details or address missing aspects',
        consistency: 'Check for contradictory statements',
        hallucinationResistance: 'Use more cautious language, avoid absolute claims',
        toxicity: 'Remove offensive or aggressive language',
        faithfulness: 'Stay closer to the source material',
        factuality: 'Add uncertainty qualifiers to statistical claims',
        coherence: 'Use transition words to connect ideas',
        conciseness: 'Remove filler words and redundant phrases',
        readability: 'Simplify sentence structure or use simpler vocabulary',
        sentiment: 'Adjust tone to better match expected sentiment',
        styleConsistency: 'Match the writing style of previous responses'
      };
      return suggestions[w.dimension] || `Improve ${w.dimension}`;
    });

    return {
      score,
      quality,
      grade: this._getGrade(score.overall),
      strengths,
      weaknesses,
      improvementSuggestions,
      summary: this._generateQualitySummary(score, quality)
    };
  }

  _generateQualitySummary(score, quality) {
    const qualityMessages = {
      excellent: `This is an excellent response with an overall score of ${score.overall}. It performs well across all dimensions.`,
      good: `This is a good response with an overall score of ${score.overall}. Consider improving ${score.weaknesses?.map(w => w.dimension).join(', ') || 'some areas'}.`,
      acceptable: `This is an acceptable response with an overall score of ${score.overall}. Several improvements could be made.`,
      poor: `This response needs significant improvement. Overall score: ${score.overall}.`
    };
    return qualityMessages[quality];
  }

  _getBasicStats(content) {
    const words = content.split(/\s+/).filter(w => w.length > 0);
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return {
      wordCount: words.length,
      sentenceCount: sentences.length
    };
  }

  _getGrade(score) {
    if (score >= 0.9) return 'A';
    if (score >= 0.8) return 'B';
    if (score >= 0.7) return 'C';
    if (score >= 0.5) return 'D';
    return 'F';
  }

  async scoreAsync(content, context = {}) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(this.score(content, context));
      }, 0);
    });
  }

  getWeights() {
    return { ...this._weights };
  }

  setWeights(weights) {
    this._weights = { ...this._weights, ...weights };
    return this;
  }
}

export default QualityScorer;
