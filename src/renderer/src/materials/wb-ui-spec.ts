export const WB_UI_SPECIFICATIONS = `
1. WbTable 复合表格组件:
   - 属性:
     - columns: Array<{ label: string, prop?: string, width?: number|string, minWidth?: number|string, fixed?: 'left'|'right', slot?: string }>
     - request-func: (params: any) => Promise<{ code: number, data: { list: any[], total: number } }>
     - pagination: boolean (是否展示分页器，默认 true)
   - 常用插槽:
     - 自定义列插槽: #slotName="{ row, column, $index }"
     - 操作列建议: fixed="right"

2. WbButton 按钮组件:
   - 继承自 ElButton，支持 type="primary"|"success"|"danger"|"warning"|"info"

3. WbDatePickerRangeSplit 起止分离日期选择:
   - v-model:start="startTime" v-model:end="endTime"
`;
