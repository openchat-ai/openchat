export class KnowledgeNetwork {
  constructor() {
    this.knowledgeGraph = new Map();
    this.communityMap = new Map();
  }

  addCommunity(communityId, topic) {
    this.communityMap.set(communityId, { topic, items: [] });
  }

  acquireKnowledgeFromSocial(authorId, knowledge) {
    return null;
  }

  addKnowledge(knowledge, opts) {
    return null;
  }
}

export const knowledgeNetwork = new KnowledgeNetwork();
export default knowledgeNetwork;
