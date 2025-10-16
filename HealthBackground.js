import React from 'react';

const HealthBackground = () => {
  const styles = {
    healthBackground: {
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'linear-gradient(135deg, #87CEEB 0%, #98D8E8 50%, #B0E0E6 100%)',
      zIndex: -2
    }
  };

  return (
    <div style={styles.healthBackground}></div>
  );
};

export default HealthBackground;
