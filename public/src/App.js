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
    p.numero.includes(filtro) ||
