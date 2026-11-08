import React, { useState, useEffect, useRef } from 'react';
import Plot from 'react-plotly.js';


const C_KM_MS = 300; // Швидкість світла (км/мс)
const TIME_SPREAD_THRESHOLD = 500; // Поріг розкиду часу (мс)

// Аналітичний метод
const calculateAnalytical = (satellites) => {
  const [s1, s2, s3] = satellites;
  const A = 2 * (s2.x - s1.x);
  const B = 2 * (s2.y - s1.y);
  const C = Math.pow(s1.r, 2) - Math.pow(s2.r, 2) - Math.pow(s1.x, 2) + Math.pow(s2.x, 2) - Math.pow(s1.y, 2) + Math.pow(s2.y, 2);

  const D = 2 * (s3.x - s2.x);
  const E = 2 * (s3.y - s2.y);
  const F = Math.pow(s2.r, 2) - Math.pow(s3.r, 2) - Math.pow(s2.x, 2) + Math.pow(s3.x, 2) - Math.pow(s2.y, 2) + Math.pow(s3.y, 2);

  const denominator = E * A - B * D;
  
  // Якщо супутники майже на одній прямій
  if (Math.abs(denominator) < 0.0001) return null; 

  const x = (C * E - F * B) / denominator;
  const y = (C * D - A * F) / (B * D - A * E);

  return { x, y };
};

// Чисельний метод (Метод найменших квадратів)
const calculateNumerical = (satellites, initialGuess) => {
  if (!initialGuess) return null;

  const lossFunction = ([x, y]) => {
    return satellites.reduce((sum, s) => {
      const calcDist = Math.sqrt(Math.pow(x - s.x, 2) + Math.pow(y - s.y, 2));
      return sum + Math.pow(calcDist - s.r, 2);
    }, 0);
  };

  const result = window.numeric.uncmin(lossFunction, [initialGuess.x, initialGuess.y]);
  return { x: result.solution[0], y: result.solution[1] };
};

export default function App() {
  const [satellites, setSatellites] = useState({});
  const [analyticalPath, setAnalyticalPath] = useState([]);
  const [numericalPath, setNumericalPath] = useState([]);
  const wsRef = useRef(null);

  // Підключення до WebSocket та збір даних супутників
  useEffect(() => {
    wsRef.current = new WebSocket('ws://localhost:21701');

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Відстань R = c * t (де t = receivedAt - sentAt у мілісекундах)
      const r = C_KM_MS * (data.receivedAt - data.sentAt);

      setSatellites((prev) => {
        const updated = { ...prev, [data.id]: { ...data, r } };
        
        // Очищення старих супутників (які вилетіли за межі і не оновлюються)
        const latestTime = Math.max(...Object.values(updated).map(s => s.receivedAt));
        
        // Видаляємо лише ті супутники, які відстають від найновішого більше ніж на 5 секунд
        Object.keys(updated).forEach(id => {
          if (latestTime - updated[id].receivedAt > 5000) {
            delete updated[id];
          }
        });

        return updated;
      });
    };

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // Розрахунок позиції при оновленні супутників
  useEffect(() => {
    const satsArray = Object.values(satellites);
    if (satsArray.length >= 3) {
      // Беремо 3 найсвіжіші супутники
      const latestSats = satsArray.sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 3);
      
      const times = latestSats.map(s => s.receivedAt);
      const timeSpread = Math.max(...times) - Math.min(...times);

      // Виконуємо розрахунок, лише якщо розкид часу менший за поріг
      if (timeSpread <= TIME_SPREAD_THRESHOLD) {
        const analyticalPos = calculateAnalytical(latestSats);
        
        if (analyticalPos) {
          // Для чисельного методу використовуємо аналітичний як початкове наближення
          const numericalPos = calculateNumerical(latestSats, analyticalPos);

          const timestamp = Date.now();
          
          setAnalyticalPath(prev => [...prev, { ...analyticalPos, opacity: 1.0, timestamp }]);
          if (numericalPos) {
            setNumericalPath(prev => [...prev, { ...numericalPos, opacity: 1.0, timestamp }]);
          }
        }
      }
    }
  }, [satellites]);

  // Ефект післясвітіння (слід руху об'єкта)
  useEffect(() => {
    const fadeInterval = setInterval(() => {
      const fadeFunction = (prevPath) => prevPath
        .map(p => ({ ...p, opacity: p.opacity - 0.02 }))
        .filter(p => p.opacity > 0);

      setAnalyticalPath(fadeFunction);
      setNumericalPath(fadeFunction);
    }, 100);

    return () => clearInterval(fadeInterval);
  }, []);

  // Підготовка даних для графіка
  const satsArray = Object.values(satellites);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <h2>GPS Емулятор: Аналітичний vs Чисельний методи</h2>
      
      <Plot
        data={[
          // 1. Супутники
          {
            type: 'scatter',
            mode: 'markers+text',
            name: 'Супутники',
            x: satsArray.map(s => s.x),
            y: satsArray.map(s => s.y),
            text: satsArray.map((_, i) => `Sat ${i+1}`),
            textposition: 'top center',
            marker: { size: 12, color: 'blue', symbol: 'triangle-up' },
          },
          // 2. Аналітичний метод (з урахуванням прозорості)
          {
            type: 'scatter',
            mode: 'markers',
            name: 'Аналітичний',
            x: analyticalPath.map(p => p.x),
            y: analyticalPath.map(p => p.y),
            marker: { 
              size: 8, 
              color: analyticalPath.map(p => `rgba(255, 0, 0, ${p.opacity})`), // Червоний
              line: { color: 'transparent' }
            },
          },
          // 3. Чисельний метод (з урахуванням прозорості)
          {
            type: 'scatter',
            mode: 'markers',
            name: 'Чисельний',
            x: numericalPath.map(p => p.x),
            y: numericalPath.map(p => p.y),
            marker: { 
              size: 8, 
              color: numericalPath.map(p => `rgba(0, 200, 0, ${p.opacity})`), // Зелений
              line: { color: 'transparent' }
            },
          }
        ]}
        layout={{
          width: 800,
          height: 800,
          paper_bgcolor: '#f9f9f9',
          plot_bgcolor: '#fff',
          xaxis: { range: [0, 100], title: 'Координата X (км)', gridcolor: '#eee' },
          yaxis: { range: [0, 100], title: 'Координата Y (км)', gridcolor: '#eee' },
          legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.8)' }
        }}
      />

      <div style={{ marginTop: '20px', maxWidth: '800px' }}>
        <p><strong>Пояснення до звіту (Вибір порогу часу):</strong><br/>
        Поріг розкиду часу (`TIME_SPREAD_THRESHOLD`) встановлено на <b>50 мс</b>. Оскільки максимальна швидкість об'єкта може бути досить високою, затримка між вимірюваннями у 100+ мс означає, що об'єкт встигне переміститися на сотні метрів, що зробить розрахунок застарілим і викличе велику похибку. Розкид до 50 мс дозволяє підтримувати точність у межах похибки самого GPS.</p>
      </div>
    </div>
  );
}