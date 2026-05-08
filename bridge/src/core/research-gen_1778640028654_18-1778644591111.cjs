// Research by 小红: 研究 GraphQL vs REST 在 Bridge API 中的优劣
// Generated: 2026-05-13T03:56:31.111Z

// 引入必要的依赖
const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const { RESTDataSource } = require('apollo-datasource-rest');

// 定义类型和查询
const typeDefs = gql`
  type User {
    id: ID!
    name: String!
    email: String!
    followers: [Follow!]!
  }

  type Follow {
    followerId: ID!
    followingId: ID!
  }

  type Query {
    user(id: ID!): User
    userPosts(userId: ID!): [Post!]!
  }
`;

// 定义数据源
class BridgeDataSource extends RESTDataSource {
  constructor() {
    super();
    this.baseURL = 'http://localhost:3000';
  }

  async get(user) {
    return this.get('/users/' + user.id);
  }

  async posts(userId) {
    return this.get('/users/' + userId + '/posts');
  }
}

// 创建 Apollo Server
const apolloServer = new ApolloServer({
  typeDefs,
  dataSources: () => new BridgeDataSource(),
  context: ({ req }) => ({ req }),
});

// 实例化 REST 服务
const restServer = express();
restServer.get('/users/:id', (req, res) => {
  const user = { id: req.params.id, name: 'Alice', email: 'alice@example.com', followers: [] };
  res.json(user);
});

restServer.get('/users/:userId/posts', (req, res) => {
  const posts = [{ id: '1', content: 'Hello World' }, { id: '2', content: 'GraphQL is cool' }];
  res.json(posts);
});

// 启动服务
const httpServer = express();
httpServer.use(apolloServer.applyMiddleware({ app: httpServer }));
httpServer.use('/api', restServer);

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Server ready at http://localhost:${PORT}${apolloServer.graphqlPath}`);
});

// 测试查询
const testQuery = `
  query {
    user(id: "1") {
      id
      name
      email
      followers {
        followerId
        followingId
      }
    }
    userPosts(userId: "1") {
      id
      content
    }
  }
`;

// 模拟执行 GraphQL 查询
(async () => {
  const { data } = await apolloServer.executeOperation({
    query: testQuery,
  });
  console.log('GraphQL 查询结果:', data);
})();