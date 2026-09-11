import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [processos, setProcessos] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [view, setView] = useState('processos');
  const [editandoId, setEditandoId] = useState(null);
  const [formEdit, setFormEdit] = useState({});
  const [formNovo, setFormNovo] = useState({
    numero: '', partes: '', classe: 'Civil', prazo: '', honorarios: 0
  });

  useEffect(() => {
    const salvos = localStorage.getItem('processos_joao');
    if (salvos) {
      setProcessos(JSON.parse(salvos));
    } else {
      setProcessos([
        { id: 1, numero: '0036663-87', partes: 'Vitima vs Reu', classe: 'Acao Penal', prazo: '2026-09-14', honorarios: 0 }
      ]);
    }
  }, []);

  const salvar = (novos) => {
    setProcessos(novos);
    localStorage.setItem('processos_joao', JSON.stringify(novos));
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

  const abrirEdicao = (p) => {
    setEditandoId(p.id);
    setFormEdit({...p});
  };

  const salvarEdicao = () => {
    const novos = processos.map(p => p.id === editandoId ? formEdit : p);
    salvar(novos);
    setEditandoId(null);
  };

  const adicionarProcesso = () => {
    if (!formNovo.numero || !formNovo.partes || !formNovo.prazo) {
      alert('Preencha todos os campos');
      return;
    }
    const novo = { id: Date.now(), ...formNovo, honorarios: parseInt(formNovo.honorarios) || 0 };
    salvar([novo, ...processos]);
    setFormNovo({ numero: '', partes: '', classe: 'Civil', prazo: '', honorarios: 0 });
    setView('processos');
  };

  const remover = (id) => {
    salvar(processos.filter(p => p.id !== id));
  };

  const filtrados = processos.filter(p => 
    p.numero.includes(filtro) || p.partes.toLowerCase().includes(filtro.toLowerCase())
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

          <button className="menu-btn excel-btn">
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
                className="search-input"
                placeholder="Buscar processo ou partes..."
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
              />

              <table className="table">
                <thead>
                  <tr>
                    <th>Processo</th>
                    <th>Partes</th>
                    <th>Classe</th>
                    <th>Prazo</th>
                    <th>Dias</th>
                    <th>Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map(p => (
                    <tr key={p.id}>
                      <td className="numero">{p.numero}</td>
                      <td>{p.partes}</td>
                      <td>{p.classe}</td>
                      <td>{p.prazo}</td>
                      <td style={{ color: getCor(diasAte(p.prazo)), fontWeight: 'bold' }}>
                        {diasAte(p.prazo)}d
                      </td>
                      <td className="action">
                        <button onClick={() => abrirEdicao(p)}>Editar</button>
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
              <h2>Adicionar Novo Processo</h2>
              
              <div className="form-group">
                <label>Numero do Processo</label>
                <input 
                  type="text" 
                  value={formNovo.numero}
                  onChange={(e) => setFormNovo({...formNovo, numero: e.target.value})}
                  placeholder="Ex: 0036663-87"
                />
              </div>

              <div className="form-group">
                <label>Partes</label>
                <input 
                  type="text" 
                  value={formNovo.partes}
                  onChange={(e) => setFormNovo({...formNovo, partes: e.target.value})}
                  placeholder="Ex: Vitima vs Reu"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Classe</label>
                  <select value={formNovo.classe} onChange={(e) => setFormNovo({...formNovo, classe: e.target.value})}>
                    <option>Civil</option>
                    <option>Acao Penal</option>
                    <option>Execucao</option>
                    <option>Administrativo</option>
                    <option>Trabalhista</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Prazo</label>
                  <input 
                    type="date" 
                    value={formNovo.prazo}
                    onChange={(e) => setFormNovo({...formNovo, prazo: e.target.value})}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Honorarios</label>
                <input 
                  type="number" 
                  value={formNovo.honorarios}
                  onChange={(e) => setFormNovo({...formNovo, honorarios: e.target.value})}
                  placeholder="0"
                />
              </div>

              <div className="form-buttons">
                <button className="btn-cancel" onClick={() => setView('processos')}>Cancelar</button>
                <button className="btn-submit" onClick={adicionarProcesso}>Adicionar</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {editandoId && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h2>Editar Processo</h2>
            
            <div className="form-group">
              <label>Numero</label>
              <input type="text" value={formEdit.numero || ''} onChange={(e) => setFormEdit({...formEdit, numero: e.target.value})} />
            </div>

            <div className="form-group">
              <label>Partes</label>
              <input type="text" value={formEdit.partes || ''} onChange={(e) => setFormEdit({...formEdit, partes: e.target.value})} />
            </div>

            <div className="form-group">
              <label>Classe</label>
              <select value={formEdit.classe || 'Civil'} onChange={(e) => setFormEdit({...formEdit, classe: e.target.value})}>
                <option>Civil</option>
                <option>Acao Penal</option>
                <option>Execucao</option>
                <option>Administrativo</option>
              </select>
            </div>

            <div className="form-group">
              <label>Prazo</label>
              <input type="date" value={formEdit.prazo || ''} onChange={(e) => setFormEdit({...formEdit, prazo: e.target.value})} />
            </div>

            <div className="form-group">
              <label>Honorarios</label>
              <input type="number" value={formEdit.honorarios || 0} onChange={(e) => setFormEdit({...formEdit, honorarios: e.target.value})} />
            </div>

            <div className="modal-buttons">
              <button className="btn-cancel" onClick={() => setEditandoId(null)}>Cancelar</button>
              <button className="btn-submit" onClick={salvarEdicao}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
