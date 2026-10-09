// Seed content: default rules and a sample notebook.

export const DEFAULT_RULES = [
  {
    id: 'r1',
    name: 'Name the data',
    condition: 'The prompt refers to "the data", "the table", "it" or similar without naming the DataFrame variable, while the notebook defines one or more DataFrames.',
    guidance: 'Name the exact DataFrame variable to use (e.g. `sales`).',
    severity: 'warning',
  },
  {
    id: 'r2',
    name: 'Use exact column names',
    condition: 'The prompt mentions a column loosely (paraphrased, wrong case, or a synonym) when the notebook context lists the actual column names.',
    guidance: 'Replace the loose reference with the exact column name(s) from the notebook, in backticks.',
    severity: 'warning',
  },
  {
    id: 'r3',
    name: 'Specify the chart',
    condition: 'The prompt asks for a plot or visualization but does not say which chart type, axes, or library to use.',
    guidance: 'State chart type, x and y columns, and the plotting library already imported in the notebook.',
    severity: 'info',
  },
  {
    id: 'r4',
    name: 'Say what to return',
    condition: 'The prompt asks for a computation but does not say what form the result should take (new variable, printed table, new column, figure).',
    guidance: 'Say where the result goes, e.g. "store it in a new DataFrame called `...`" or "display the result".',
    severity: 'info',
  },
  {
    id: 'r5',
    name: 'Handle missing values',
    condition: 'The prompt asks for aggregation, modelling or plotting on columns that the notebook context shows contain missing values (NaN), without saying how to treat them.',
    guidance: 'Say how missing values should be handled (drop rows, fill with a value, or keep and report).',
    severity: 'info',
  },
];

export const SAMPLE_NOTEBOOK = {
  title: 'Store sales analysis',
  cells: [
    { id: 'c1', type: 'markdown', source: '# Store sales analysis\nQuarterly sales for our three regions.', output: '' },
    { id: 'c2', type: 'code', source: 'import pandas as pd\nimport matplotlib.pyplot as plt', output: '' },
    {
      id: 'c3', type: 'code',
      source: "sales = pd.read_csv('sales_2024.csv', parse_dates=['order_date'])\nsales.head()",
      output: '   order_id order_date  region  product_category  units  unit_price  discount\n0      1001 2024-01-03   North       Electronics      2      199.99       0.10\n1      1002 2024-01-03   South         Furniture      1      349.00         NaN\n2      1003 2024-01-04    West       Electronics      5       19.99       0.00\n3      1004 2024-01-05   North    Office Supplies     12        4.50         NaN\n4      1005 2024-01-06   South       Electronics      1      899.00       0.15',
    },
    { id: 'c4', type: 'code', source: 'sales.isna().sum()', output: 'order_id            0\norder_date          0\nregion              0\nproduct_category    0\nunits               0\nunit_price          0\ndiscount          412\ndtype: int64' },
    { id: 'c5', type: 'markdown', source: '## Revenue', output: '' },
    { id: 'c6', type: 'code', source: "sales['revenue'] = sales['units'] * sales['unit_price']", output: '' },
  ],
};
