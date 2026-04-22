#!/bin/bash

# 🔍 检查全局约定规范是否已正确安装和启用

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  🔍 OpenChat 全局约定规范 - 安装检查                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

CHECKS_PASSED=0
CHECKS_FAILED=0

# 检查1：规范文档
echo "📋 检查1：规范文档"
for doc in GLOBAL_CONVENTIONS.md STATUS_CONVENTION.md CONVENTIONS_CHEATSHEET.md QUICK_START.md; do
    if [ -f "$doc" ]; then
        echo -e "  ${GREEN}✅${NC} $doc"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
    else
        echo -e "  ${RED}❌${NC} $doc 缺失"
        CHECKS_FAILED=$((CHECKS_FAILED + 1))
    fi
done
echo ""

# 检查2：预提交钩子
echo "🤖 检查2：预提交钩子"
if [ -f ".git/hooks/pre-commit" ]; then
    if [ -x ".git/hooks/pre-commit" ]; then
        echo -e "  ${GREEN}✅${NC} .git/hooks/pre-commit 已安装且可执行"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
    else
        echo -e "  ${YELLOW}⚠️${NC} .git/hooks/pre-commit 存在但不可执行"
        chmod +x ".git/hooks/pre-commit"
        echo -e "  ${GREEN}✅${NC} 已修复权限"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
    fi
else
    echo -e "  ${RED}❌${NC} .git/hooks/pre-commit 未安装"
    echo -e "     ${YELLOW}运行: bash setup-conventions.sh${NC}"
    CHECKS_FAILED=$((CHECKS_FAILED + 1))
fi
echo ""

# 检查3：Post-checkout 钩子
echo "🔄 检查3：Post-checkout 钩子"
if [ -f ".git/hooks/post-checkout" ]; then
    if [ -x ".git/hooks/post-checkout" ]; then
        echo -e "  ${GREEN}✅${NC} .git/hooks/post-checkout 已安装且可执行"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
    else
        chmod +x ".git/hooks/post-checkout"
        echo -e "  ${GREEN}✅${NC} .git/hooks/post-checkout 权限已修复"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
    fi
else
    echo -e "  ${YELLOW}⚠️${NC} .git/hooks/post-checkout 未安装"
    echo -e "     ${YELLOW}建议: bash setup-conventions.sh${NC}"
    CHECKS_FAILED=$((CHECKS_FAILED + 1))
fi
echo ""

# 检查4：规范应用
echo "📝 检查4：规范应用到文档"
DOCS_WITH_MARKS=0
for doc in plan.md research.md rules.md; do
    if [ -f "$doc" ]; then
        if grep -q "✅\|⏱️" "$doc"; then
            echo -e "  ${GREEN}✅${NC} $doc 已应用规范"
            DOCS_WITH_MARKS=$((DOCS_WITH_MARKS + 1))
        fi
    fi
done

if [ "$DOCS_WITH_MARKS" -eq "3" ]; then
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
    echo -e "  ${RED}❌${NC} 规范未完全应用（$DOCS_WITH_MARKS/3）"
    CHECKS_FAILED=$((CHECKS_FAILED + 1))
fi
echo ""

# 检查5：Git配置
echo "⚙️  检查5：Git 配置"
if git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "  ${GREEN}✅${NC} Git 仓库已正确初始化"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
    echo -e "  ${RED}❌${NC} Git 仓库未正确初始化"
    CHECKS_FAILED=$((CHECKS_FAILED + 1))
fi
echo ""

# 最终结果
echo "╔══════════════════════════════════════════════════════════════╗"
if [ $CHECKS_FAILED -eq 0 ]; then
    echo -e "║  ${GREEN}✅ 所有检查通过！规范已完整安装${NC}                      ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "📊 检查结果："
    echo "  ✅ 通过：$CHECKS_PASSED 项"
    echo "  ❌ 失败：$CHECKS_FAILED 项"
    echo ""
    echo "🚀 现在可以开始开发了！"
    echo "   运行 git commit 时会自动检查规范"
    echo ""
    exit 0
else
    echo -e "║  ${RED}❌ 发现 $CHECKS_FAILED 个检查失败${NC}                      ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "📊 检查结果："
    echo "  ✅ 通过：$CHECKS_PASSED 项"
    echo "  ❌ 失败：$CHECKS_FAILED 项"
    echo ""
    echo "💡 解决方案："
    echo "  1. 运行: bash setup-conventions.sh"
    echo "  2. 重新运行: bash check-conventions.sh"
    echo ""
    exit 1
fi
