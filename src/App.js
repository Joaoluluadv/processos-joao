import React, { useState } from 'react';
import './App.css';

function App() {
  const [processos, setProcessos] = useState([
    { id: 1, numero: '0036663-87', partes: 'Vitima vs Reu', prazo: '2026-09-14' }
  ]);

  return (
    <div className="container">
      <div className="sidebar">
        <h1>Processos - Joao</h1>
        <button className="menu-btn active">Processos</button>
      </div>
      <div className="main">
        <div className="header">
          <h2>Meus Processos</h2>
        </div>
        <div className="content">
          <table className="table">
            <thead>
              <tr>
                <th>Processo</th>
                <th>Partes</th>
                <th>Prazo</th>
              </tr>
            </thead>
            <tbody>
              {processos.map(p => (
                <tr key={p.id}>
                  <td>{p.numero}</td>
                  <td>{p.partes}</td>
                  <td>{p.prazo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default App;
