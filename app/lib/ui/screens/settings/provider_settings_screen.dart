import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/providers/bridge_provider.dart';
import 'package:openchat/ui/theme/colors.dart';

/// Provider 设置界面
class ProviderSettingsScreen extends ConsumerStatefulWidget {
  const ProviderSettingsScreen({super.key});

  @override
  ConsumerState<ProviderSettingsScreen> createState() => _ProviderSettingsScreenState();
}

class _ProviderSettingsScreenState extends ConsumerState<ProviderSettingsScreen> {
  List<Map<String, dynamic>> _providers = [];
  List<Map<String, dynamic>> _filteredProviders = [];
  bool _isLoading = true;
  String? _error;
  String _searchQuery = '';
  String? _currentProvider;
  String? _currentModel;

  @override
  void initState() {
    super.initState();
    _loadProviders();
  }

  Future<void> _loadProviders() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final bridgeService = ref.read(bridgeServiceProvider);

      // 并行获取状态和 Provider 列表
      final results = await Future.wait([
        bridgeService.fetchStatus(),
        bridgeService.fetchProviders(),
      ]);

      final status = results[0] as Map<String, dynamic>?;
      final providers = results[1] as List<Map<String, dynamic>>;

      _currentProvider = status?['currentProvider'];
      _currentModel = status?['currentModel'];
      _providers = providers;
      _filterProviders();

      setState(() {
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  void _filterProviders() {
    if (_searchQuery.isEmpty) {
      _filteredProviders = _providers;
    } else {
      final query = _searchQuery.toLowerCase();
      _filteredProviders = _providers.where((p) {
        final name = (p['nameCn'] ?? p['name'] ?? p['id'] ?? '').toString().toLowerCase();
        final id = (p['id'] ?? '').toString().toLowerCase();
        return name.contains(query) || id.contains(query);
      }).toList();
    }
  }

  Future<void> _configureProvider(Map<String, dynamic> provider) async {
    final apiKeyController = TextEditingController();
    final baseUrlController = TextEditingController();
    bool isTesting = false;
    String? testError;
    bool? testSuccess;

    await showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: AppColors.surfaceDark,
          title: Row(
            children: [
              Expanded(child: Text('配置 ${provider['nameCn'] ?? provider['id']}')),
              if (provider['hasApiKey'] == true)
                const Icon(Icons.check_circle, color: AppColors.success, size: 20),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (provider['description'] != null) ...[
                Text(
                  provider['description'],
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 16),
              ],
              TextField(
                controller: apiKeyController,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'API Key',
                  labelStyle: const TextStyle(color: AppColors.textSecondary),
                  filled: true,
                  fillColor: AppColors.backgroundDark,
                  border: const OutlineInputBorder(
                    borderRadius: BorderRadius.all(Radius.circular(8)),
                    borderSide: BorderSide.none,
                  ),
                  suffixIcon: apiKeyController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, size: 18),
                          onPressed: () {
                            apiKeyController.clear();
                            setDialogState(() {});
                          },
                        )
                      : null,
                ),
                obscureText: true,
                onChanged: (_) => setDialogState(() {}),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: baseUrlController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Base URL (可选)',
                  labelStyle: TextStyle(color: AppColors.textSecondary),
                  filled: true,
                  fillColor: AppColors.backgroundDark,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.all(Radius.circular(8)),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
              if (testError != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.error.withAlpha(30),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline, color: AppColors.error, size: 16),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          testError!,
                          style: const TextStyle(color: AppColors.error, fontSize: 12),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              if (testSuccess == true) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.success.withAlpha(30),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.check_circle, color: AppColors.success, size: 16),
                      SizedBox(width: 8),
                      Text(
                        '连接测试成功',
                        style: TextStyle(color: AppColors.success, fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: isTesting ? null : () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            if (apiKeyController.text.isNotEmpty)
              TextButton(
                onPressed: isTesting
                    ? null
                    : () async {
                        setDialogState(() {
                          isTesting = true;
                          testError = null;
                          testSuccess = null;
                        });

                        final bridgeService = ref.read(bridgeServiceProvider);
                        final success = await bridgeService.configureProvider(
                          providerId: provider['id'],
                          apiKey: apiKeyController.text,
                          baseUrl: baseUrlController.text.isNotEmpty ? baseUrlController.text : null,
                        );

                        setDialogState(() {
                          isTesting = false;
                          if (success) {
                            testSuccess = true;
                          } else {
                            testError = '连接失败，请检查 API Key';
                          }
                        });
                      },
                child: isTesting
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('测试连接'),
              ),
            ElevatedButton(
              onPressed: isTesting ? null : () => Navigator.pop(context, true),
              child: const Text('保存'),
            ),
          ],
        ),
      ),
    ).then((result) async {
      if (result == true && mounted) {
        final bridgeService = ref.read(bridgeServiceProvider);
        final success = await bridgeService.configureProvider(
          providerId: provider['id'],
          apiKey: apiKeyController.text.isNotEmpty ? apiKeyController.text : null,
          baseUrl: baseUrlController.text.isNotEmpty ? baseUrlController.text : null,
        );

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(success ? '配置已保存' : '配置失败'),
              backgroundColor: success ? AppColors.success : AppColors.error,
            ),
          );
          if (success) {
            _loadProviders();
          }
        }
      }
    });
  }

  Future<void> _selectModel(Map<String, dynamic> provider) async {
    final bridgeService = ref.read(bridgeServiceProvider);

    // 获取模型列表
    List<String> models = List<String>.from(provider['models'] ?? []);

    // 如果模型列表为空，尝试从 Bridge 获取
    if (models.isEmpty && provider['hasApiKey'] == true) {
      // TODO: 调用 API 获取模型列表
    }

    if (models.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('该服务商暂无可用模型'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }

    final TextEditingController searchController = TextEditingController();
    List<String> filteredModels = models;

    final result = await showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: AppColors.surfaceDark,
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('选择模型 - ${provider['nameCn'] ?? provider['id']}'),
              const SizedBox(height: 12),
              TextField(
                controller: searchController,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                decoration: InputDecoration(
                  hintText: '搜索模型...',
                  hintStyle: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
                  filled: true,
                  fillColor: AppColors.backgroundDark,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide.none,
                  ),
                  prefixIcon: const Icon(Icons.search, size: 18, color: AppColors.textSecondary),
                ),
                onChanged: (query) {
                  setDialogState(() {
                    filteredModels = models.where((m) => m.toLowerCase().contains(query.toLowerCase())).toList();
                  });
                },
              ),
            ],
          ),
          content: SizedBox(
            width: double.maxFinite,
            height: 350,
            child: filteredModels.isEmpty
                ? const Center(
                    child: Text(
                      '未找到匹配的模型',
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                  )
                : ListView.builder(
                    itemCount: filteredModels.length,
                    itemBuilder: (context, index) {
                      final model = filteredModels[index];
                      final isCurrentModel = model == _currentModel && provider['id'] == _currentProvider;
                      return ListTile(
                        dense: true,
                        leading: isCurrentModel
                            ? const Icon(Icons.check_circle, color: AppColors.primary, size: 20)
                            : const SizedBox(width: 20),
                        title: Text(
                          model,
                          style: TextStyle(
                            color: isCurrentModel ? AppColors.primary : Colors.white,
                            fontSize: 13,
                            fontWeight: isCurrentModel ? FontWeight.w600 : FontWeight.normal,
                          ),
                        ),
                        onTap: () => Navigator.pop(context, model),
                      );
                    },
                  ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
          ],
        ),
      ),
    );

    if (result != null && mounted) {
      final success = await bridgeService.setCurrentProvider(
        providerId: provider['id'],
        model: result,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(success
                ? '已切换到 ${provider['nameCn'] ?? provider['id']} / $result'
                : '切换失败'),
            backgroundColor: success ? AppColors.success : AppColors.error,
          ),
        );
        if (success) {
          _loadProviders();
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.backgroundDark,
      appBar: AppBar(
        backgroundColor: AppColors.surfaceDark,
        title: const Text('AI 服务商'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _isLoading ? null : _loadProviders,
            tooltip: '刷新',
          ),
        ],
      ),
      body: Column(
        children: [
          // 搜索栏
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: '搜索服务商...',
                hintStyle: const TextStyle(color: AppColors.textSecondary),
                filled: true,
                fillColor: AppColors.surfaceDark,
                prefixIcon: const Icon(Icons.search, color: AppColors.textSecondary),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
              onChanged: (query) {
                setState(() {
                  _searchQuery = query;
                  _filterProviders();
                });
              },
            ),
          ),
          // 当前选择
          if (_currentProvider != null)
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.primary.withAlpha(20),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.primary.withAlpha(50)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle, color: AppColors.primary, size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          '当前使用',
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 11),
                        ),
                        Text(
                          '$_currentProvider / ${_currentModel ?? "默认"}',
                          style: const TextStyle(
                            color: AppColors.primary,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 8),
          // Provider 列表
          Expanded(
            child: _buildBody(),
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.primary),
      );
    }

    if (_error != null) {
      return _buildErrorState();
    }

    if (_providers.isEmpty) {
      return _buildEmptyState('无法获取服务商列表', '请确保 Bridge 服务正在运行');
    }

    if (_filteredProviders.isEmpty) {
      return _buildEmptyState('未找到匹配的服务商', '请尝试其他搜索词');
    }

    // 分组：已配置和未配置
    final configured = _filteredProviders.where((p) => p['hasApiKey'] == true).toList();
    final unconfigured = _filteredProviders.where((p) => p['hasApiKey'] != true).toList();

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      children: [
        if (configured.isNotEmpty) ...[
          const Padding(
            padding: EdgeInsets.only(top: 8, bottom: 8),
            child: Text(
              '已配置',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          ...configured.map((p) => _buildProviderCard(p)),
        ],
        if (unconfigured.isNotEmpty) ...[
          Padding(
            padding: EdgeInsets.only(top: configured.isNotEmpty ? 16 : 8, bottom: 8),
            child: const Text(
              '未配置',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          ...unconfigured.map((p) => _buildProviderCard(p)),
        ],
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _buildProviderCard(Map<String, dynamic> provider) {
    final isCurrent = provider['id'] == _currentProvider;
    final hasKey = provider['hasApiKey'] == true;
    final modelCount = provider['modelCount'] ?? (provider['models'] as List?)?.length ?? 0;

    return Card(
      color: AppColors.surfaceDark,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: isCurrent
            ? const BorderSide(color: AppColors.primary, width: 1.5)
            : BorderSide.none,
      ),
      child: InkWell(
        onTap: hasKey ? () => _selectModel(provider) : null,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              // 图标
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: isCurrent
                      ? AppColors.primary.withAlpha(20)
                      : AppColors.backgroundDark,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Center(
                  child: Text(
                    (provider['nameCn'] ?? provider['id'] ?? '?')[0].toUpperCase(),
                    style: TextStyle(
                      color: isCurrent ? AppColors.primary : AppColors.textSecondary,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // 信息
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            provider['nameCn'] ?? provider['name'] ?? provider['id'] ?? 'Unknown',
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (isCurrent) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withAlpha(20),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: const Text(
                              '当前',
                              style: TextStyle(color: AppColors.primary, fontSize: 10),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      hasKey ? '$modelCount 个模型可用' : '点击配置 API Key',
                      style: TextStyle(
                        fontSize: 12,
                        color: hasKey ? AppColors.success : AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              // 操作按钮
              IconButton(
                icon: Icon(
                  hasKey ? Icons.settings_outlined : Icons.add_circle_outline,
                  color: hasKey ? AppColors.textSecondary : AppColors.primary,
                  size: 22,
                ),
                onPressed: () => _configureProvider(provider),
                tooltip: hasKey ? '设置' : '配置',
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 48, color: AppColors.error),
            const SizedBox(height: 16),
            const Text(
              '加载失败',
              style: TextStyle(color: AppColors.error, fontSize: 16),
            ),
            const SizedBox(height: 8),
            Text(
              _error ?? '未知错误',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: _loadProviders,
              icon: const Icon(Icons.refresh),
              label: const Text('重试'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState(String title, String subtitle) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.cloud_off_outlined,
              size: 48,
              color: AppColors.textSecondary.withAlpha(150),
            ),
            const SizedBox(height: 16),
            Text(
              title,
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
            ),
            const SizedBox(height: 4),
            Text(
              subtitle,
              style: TextStyle(
                color: AppColors.textSecondary.withAlpha(150),
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
