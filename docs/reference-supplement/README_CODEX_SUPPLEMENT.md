# Codex V0.19 原始参考文件补充包

这个ZIP针对“已收到Excel/审计，但缺少参考程序、黄金样例、修正档位和开发指令”的情况整理。
请将本包解压到 Codex **项目根目录**，保持 `data/`、`tests/` 文件夹结构不变。

## 文件优先级
1. `CODEX_START_HERE.md` — 模型版本/边界及入口
2. `CODEX_IMPLEMENTATION_SPEC.md` — 程序规格
3. `CODEX_WEBAPP_BUILD_PROMPT.md` — Web App 开发任务
4. `MODEL_POLICY_V019.json` 与 `source-correction-policy-v0.16.json` — 规则数据
5. `nmc_reference_v019.py` 与 `model_engine_v016_frozen.py` — 计算参考
6. `data/GOLDEN_CALC_FIXTURES.json` 和 `tests/test_v019.py` — 测试与预期

## 先运行
`python -m unittest discover -s tests -v`
（使用Python标准库，不要求安装第三方库）

不得自造五档来源比例；不得擅自将中国市场索引别名生成新的正式风格ID。
真实音乐评分和市场频率未被程序验证，实验性配置和正式发布资格需按手册区分。
