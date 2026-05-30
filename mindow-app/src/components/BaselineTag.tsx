/**
 * BaselineTag — 基线偏离标记组件
 *
 * 根据进程的 baseline_deviation 值显示不同颜色的偏离标记：
 * - null: 采样不足 10 次，不展示
 * - < 1.5: 正常范围，不展示标记
 * - >= 1.5 且 < 3.0: 黄色「⬆ 高于平时 X.X 倍」
 * - >= 3.0: 红色「⬆ 高于平时 X.X 倍」
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 */

import { useTranslation } from "react-i18next";

interface BaselineTagProps {
  /** 基线偏离倍数，null 表示采样不足 */
  deviation: number | null;
}

export function BaselineTag({ deviation }: BaselineTagProps) {
  const { t } = useTranslation();

  // 采样不足 10 次，不展示（deviation 为 null）
  if (deviation === null) {
    return null;
  }

  // 正常范围，不展示标记
  if (deviation < 1.5) {
    return null;
  }

  // 根据偏离程度确定颜色级别
  const isSevere = deviation >= 3.0;
  const colorVar = isSevere ? "var(--accent-danger)" : "var(--accent-warning)";

  const label = `↑ ${deviation.toFixed(1)}x`;

  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ml-1.5"
      style={{
        color: colorVar,
        backgroundColor: isSevere
          ? "rgba(239, 68, 68, 0.12)"
          : "rgba(251, 191, 36, 0.12)",
        border: `1px solid ${colorVar}`,
      }}
      title={t("processes.baselineTooltip", { deviation: deviation.toFixed(1) })}
    >
      {label}
    </span>
  );
}
