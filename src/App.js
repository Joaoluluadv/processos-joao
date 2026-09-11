import React, { useState, useEffect } from 'react';
import './App.css';

export default function App() {
  const [processos, setProcessos] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [view, setView] = useState('processos');

  useEffect(() => {
    const salvos = localStorage.getItem('processos_joao');
    if (salvos) {
      setProcessos(JSON.parse(salvos));
    } else {
      setProcessos([
        {
          id: 1,
          numero: '0036663-87.2025.8.16.0021',
          partes: 'Vitima vs. Reu',
          classe: 'Acao Penal',
          fase: 'Investigacao',
          prazo: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
          honorarios: 0,
          observacoes: ''
        }
      ]);
    }
  }, []);

  const salvar = (novos) => {
    setProcessos(novos);
    localStorage.setItem('processos_joao', JSON.stringify(novos));
  };

  const adicionarManual = () => {
    alert('Aba Adicionar');
  };

  const editarProcesso = (id) => {
    alert('Editar processo: ' + id);
  };

  const remover = (id) => {
    salvar(processos.filter(p => p.id !== id));
  };

  const diasAte = (prazo) => {
    return Math.ceil((new Date(prazo) - new Date()) / 86400000);
  };

  const getCor = (dias) => {
    if (dias < 0) return '#c85a54';
    if (dias === 0) return '#d97706';
    if (dias <= 5) return '#ea8c55';
    if (dias <= 15) return '#60a5fa';
    return '#10b981';
  };

  const filtrados = processos.filter(p => 
    p.numero.includes(filtro) || p.partes.includes(filtro)
  );

  return (
    <div className="container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>Processos - Joao</h1>
        </div>

        <div className="sidebar-menu">
          <button 
            className={`menu-btn ${view === 'processos' ? 'active' : ''}`}
            onClick={() => setView('processos')}
          >
            Processos
          </button>
          
          <button 
            className={`menu-btn ${view === 'adicionar' ? 'active' : ''}`}
            onClick={() => setView('adicionar')}
          >
            Adicionar
          </button>

          <button className="menu-btn excel-btn" onClick={() => alert('Exportar')}>
            Exportar
          </button>
        </div>
      </div>

      <div className="main">
        <div className="header">
          <h2>{view === 'processos' ? 'Meus Processos' : 'Adicionar Processo'}</h2>
        </div>

        <div className="content">
          {view === 'processos' && (
            <>
              <input 
                type="text" 
                className="search-box"
                placeholder="Buscar..."
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
              />

              <table className="table">
                <thead>
                  <tr>
                    <th>Processo</th>
                    <th>Partes</th>
                    <th>Prazo</th>
                    <th>Dias</th>
                    <th>Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map(p => (
                    <tr key={p.id}>
                      <td>{p.numero}</td>
                      <td>{p.partes}</td>
                      <td>{p.prazo}</td>
                      <td style={{ color: getCor(diasAte(p.prazo)), fontWeight: 600 }}>
                        {diasAte(p.prazo)}d
                      </td>
                      <td>
                        <button onClick={() => editarProcesso(p.id)}>Editar</button>
                        <button onClick={() => remover(p.id)}>Remover</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view === 'adicionar' && (
            <div className="form-container">
              <h2>Adicionar Processo</h2>
              <input type="text" placeholder="Numero" />
              <input type="text" placeholder="Partes" />
              <input type="date" />
              <button className="submit-btn" onClick={adicionarManual}>Adicionar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
