import React, { useState, useEffect } from 'react';
import './App.css';

const App = () => {
  const [processos, setProcessos] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [intimacao, setIntimacao] = useState('');
  const [view, setView] = useState('processos');
  const [sincronizando, setSincronizando] = useState(false);

  useEffect(() => {
    carregarProcessos();
  }, []);

  const carregarProcessos = async () => {
    try {
      setSincronizando(true);
      const salvos = localStorage.getItem('processos_joao');
      if (salvos) {
        setProcessos(JSON.parse(salvos));
      } else {
        const iniciais = [
          {
            id: 1,
            numero: '0036663-87.2025.8.16.0021',
            partes: 'Vítima vs. Réu',
            classe: 'Ação Penal',
            fase: 'Investigação',
            prazo: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            honorarios: 0,
          },
          {
            id: 2,
            numero: '0049493-95.2019.8.16.0021',
            partes: 'Exequente vs. Executado',
            classe: 'Execução',
            fase: 'Cumprimento',
            prazo: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            honorarios: 2500,
          },
          {
            id: 3,
            numero: '19395302',
            partes: 'Condutor vs. DETRAN',
            classe: 'Administrativo',
            fase: 'Defesa',
            prazo: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            honorarios: 1500,
          }
        ];
        setProcessos(iniciais);
        localStorage.setItem('processos_joao', JSON.stringify(iniciais));
      }
    } catch (erro) {
      console.log('Erro ao carregar');
    } finally {
      setSincronizando(false);
    }
  };

  const salvarNoFirebase = async (novosProcessos) => {
    try {
      localStorage.setItem('processos_joao', JSON.stringify(novosProcessos));
      setProcessos(novosProcessos);
    } catch (erro) {
      console.log('Erro ao sincronizar');
    }
  };

  const diasAteVencimento = (prazo) => {
    return Math.ceil((new Date(prazo) - new Date()) / (1000 * 60 * 60 * 24));
  };

  const getStatus = (dias) => {
    if (dias < 0) return 'vencido';
    if (dias === 0) return 'hoje';
    if (dias <= 5) return 'urgente';
    if (dias <= 15) return 'proximo';
    return 'normal';
  };

  const getCorStatus = (status) => {
    switch(status) {
      case 'vencido': return '#c85a54';
      case 'hoje': return '#d97706';
      case 'urgente': return '#ea8c55';
      case 'proximo': return '#60a5fa';
      case 'normal': return '#10b981';
      default: return '#6b7280';
    }
  };

  const extrairIntimacao = () => {
    if (!intimacao.trim()) return;
    
    const regex = /(\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4}|\d+)/;
    const match = intimacao.match(regex);
    
    if (match) {
      const prazo = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const novo = {
        id: Date.now(),
        numero: match[1],
        partes: 'Partes (editar)',
        classe: 'Cível',
        fase: 'Inicial',
        prazo: prazo.toISOString().split('T')[0],
        honorarios: 0,
      };
      
      const novosProcessos = [novo, ...processos];
      salvarNoFirebase(novosProcessos);
      setIntimacao('');
      setModalAberto(false);
    }
  };

  const remover = (id) => {
    const novosProcessos = processos.filter(p => p.id !== id);
    salvarNoFirebase(novosProcessos);
  };

  const processosFiltrados = processos.filter(p =>
    p.numero.includes(filtro) || p.partes.toLowerCase().includes(filtro.toLowerCase())
  );

  const processosOrdenados = [...processosFiltrados].sort((a, b) => {
    return diasAteVencimento(a.prazo) - diasAteVencimento(b.prazo);
  });

  const contarUrgentes = processos.filter(p => {
    const dias = diasAteVencimento(p.prazo);
    return dias >= 0 && dias <= 5;
  }).length;

  const totalHonorarios = processos.reduce((sum, p) => sum + (p.honorarios || 0), 0);

  const exportarExcel = () => {
    const headers = ['Processo', 'Partes', 'Classe', 'Fase', 'Prazo', 'Dias', 'Honorários'];
    const linhas = processos.map(p => {
      const dias = diasAteVencimento(p.prazo);
      return [p.numero, p.partes, p.classe, p.fase, p.prazo, dias, p.honorarios];
    });

    let csv = headers.join('\t') + '\n';
    linhas.forEach(linha => {
      csv += linha.join('\t') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `processos_${new Date().toISOString().split('T')[0]}.xlsx`;
    link.click();
  };

  return (
    <div className="container">
      <div className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-icon">📋</span>
          <h1>Processos - João</h1>
        </div>

        <div className="sidebar-menu">
          <button 
            className={`menu-btn ${view === 'processos' ? 'active' : ''}`}
            onClick={() => setView('processos')}
          >
            <span>⚖️</span>
            Processos
          </button>
          
          <button 
            className={`menu-btn ${view === 'financeiro' ? 'active' : ''}`}
            onClick={() => setView('financeiro')}
          >
            <span>💰</span>
            Financeiro
          </button>

          <button 
            className="menu-btn excel-btn"
            onClick={exportarExcel}
          >
            <span>📊</span>
            Exportar Excel
          </button>

          <button 
            className="menu-btn add-btn"
            onClick={() => setModalAberto(true)}
          >
            <span>⚡</span>
            Adicionar Intimação
          </button>
        </div>

        <div className="sidebar-footer">
          <p>{sincronizando ? '⏳ Sincronizando...' : '✓ Sincronizado'}</p>
          <p>em tempo real</p>
        </div>
      </div>

      <div className="main">
        <div className="header">
          <h2>{view === 'processos' ? 'Meus Processos' : 'Modo Financeiro'}</h2>
          <p>
            {view === 'processos' 
              ? `Total: ${processos.length} | Urgentes: ${contarUrgentes}` 
              : `Honorários: R$ ${totalHonorarios.toLocaleString('pt-BR')}`}
          </p>
        </div>

        <div className="content">
          {view === 'processos' && (
            <div>
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Buscar processo ou partes…"
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                />
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>Processo</th>
                    <th>Partes</th>
                    <th>Classe</th>
                    <th>Fase</th>
                    <th>Prazo</th>
                    <th>Dias</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {processosOrdenados.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="empty">
                        Nenhum processo encontrado
                      </td>
                    </tr>
                  ) : (
                    processosOrdenados.map(p => {
                      const dias = diasAteVencimento(p.prazo);
                      const status = getStatus(dias);
                      const cor = getCorStatus(status);
                      return (
                        <tr key={p.id}>
                          <td className="numero">{p.numero}</td>
                          <td>{p.partes}</td>
                          <td className="secondary">{p.classe}</td>
                          <td className="secondary">{p.fase}</td>
                          <td className="secondary data">{p.prazo}</td>
                          <td style={{ color: cor, fontWeight: 600 }}>
                            {dias < 0 ? '-' + Math.abs(dias) : dias}d
                          </td>
                          <td className="action">
                            <button onClick={() => remover(p.id)}>
                              Remover
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {view === 'financeiro' && (
            <div>
              <div className="total-card">
                <p className="label">Total de honorários</p>
                <p className="amount">
                  R$ {totalHonorarios.toLocaleString('pt-BR')}
                </p>
              </div>

              <div className="metrics">
                <div className="metric-card">
                  <p className="label">Ticket médio</p>
                  <p className="value">
                    R$ {processos.length > 0 ? (totalHonorarios / processos.length).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'}
                  </p>
                </div>
                <div className="metric-card">
                  <p className="label">Processos com valor</p>
                  <p className="value">
                    {processos.filter(p => p.honorarios > 0).length} de {processos.length}
                  </p>
                </div>
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>Processo</th>
                    <th>Honorários</th>
                  </tr>
                </thead>
                <tbody>
                  {processos.filter(p => p.honorarios > 0).map(p => (
                    <tr key={p.id}>
                      <td>{p.numero}</td>
                      <td className="value">
                        R$ {p.honorarios.toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modalAberto && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Capturar intimação</h2>
            <textarea 
              value={intimacao}
              onChange={(e) => setIntimacao(e.target.value)}
              placeholder="Cole o texto da intimação ou email do PROJUDI aqui…"
            />
            <div className="modal-buttons">
              <button 
                className="cancel-btn"
                onClick={() => {
                  setModalAberto(false);
                  setIntimacao('');
                }}
              >
                Cancelar
              </button>
              <button 
                className="submit-btn"
                onClick={extrairIntimacao}
              >
                Extrair prazo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
