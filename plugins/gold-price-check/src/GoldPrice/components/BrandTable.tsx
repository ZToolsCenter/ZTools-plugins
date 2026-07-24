import React from 'react';

interface BrandTableProps {
  columns: string[];
  data: string[][];
}

export default function BrandTable({ columns, data }: BrandTableProps) {
  if (data.length === 0) {
    return <p className="gold-no-data">暂无数据</p>;
  }

  return (
    <div className="gold-table-wrapper">
      <table className="gold-table">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}