import networkx as nx
from pyvis.network import Network

# 创建知识图谱示例：添加节点和边
G = nx.DiGraph()
G.add_edges_from([('Alice', 'knows', 'Bob'), ('Bob', 'works_at', 'CompanyX'), ('Alice', 'works_at', 'CompanyY')])

# 使用PyVis生成交互式可视化
net = Network(height='600px', width='100%', notebook=False, cdn_resources='remote')
net.from_nx(G)
net.show('knowledge_graph.html')
print('可视化已保存为knowledge_graph.html，请用浏览器打开交互探索。')