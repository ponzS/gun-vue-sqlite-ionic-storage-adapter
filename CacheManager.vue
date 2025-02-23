<template>
    <div class="cache-test">
      <h2 class="liquid-title">Cache Manager</h2>
      <div class="status liquid-container">
        <p class="liquid-text">Cache Size: {{ cacheSize }} items</p>
        <p class="liquid-text">Memory Usage: {{ memoryInMB }} MB</p>
        <p v-if="message" class="liquid-message">{{ message }}</p>
      </div>
      <div class="actions">
        <button
          class="liquid-button"
          :class="{ 'loading': isLoading }"
          @click="checkCacheStatus"
          :disabled="isLoading"
        >
          <span class="button-text">Check Cache Status</span>
          <span class="ripple" v-if="isLoading"></span>
        </button>
        <button
          class="liquid-button danger"
          :class="{ 'loading': isLoading }"
          @click="clearCache"
          :disabled="isLoading"
        >
          <span class="button-text">Clear Cache</span>
          <span class="ripple" v-if="isLoading"></span>
        </button>
      </div>
    </div>
  </template>
  
  <script setup>
  import { ref, onMounted, computed } from 'vue';
  import gunIonicAdapter from '@/composables/gun-ionic-adapter.ts';
  
  const cacheSize = ref(0);
  const memoryBytes = ref(0);
  const message = ref('');
  const isLoading = ref(false);
  
  const memoryInMB = computed(() => {
    const mb = memoryBytes.value / (1024 * 1024);
    return mb.toFixed(2);
  });
  
  const checkCacheStatus = async () => {
    isLoading.value = true;
    message.value = '';
    try {
      const status = gunIonicAdapter.getCacheStatus();
      cacheSize.value = status.size;
      memoryBytes.value = status.memoryBytes;
      message.value = `Cache status checked: ${status.size} items, ${memoryInMB.value} MB`;
      console.log(message.value);
    } catch (error) {
      message.value = `Failed to check cache status: ${error.message}`;
      console.error(message.value);
    } finally {
      isLoading.value = false;
    }
  };
  
  const clearCache = async () => {
    isLoading.value = true;
    message.value = '';
    try {
      await gunIonicAdapter.clearCache();
      cacheSize.value = 0;
      memoryBytes.value = 0;
      message.value = 'Cache cleared successfully!';
      console.log(message.value);
    } catch (error) {
      message.value = `Failed to clear cache: ${error.message}`;
      console.error(message.value);
    } finally {
      isLoading.value = false;
    }
  };
  
  onMounted(async () => {
    await checkCacheStatus();
  });
  </script>
  
  <style scoped>
  .cache-test {
    padding: 20px;
    max-width: 600px;
    margin: 0 auto;
    font-family: 'Arial', sans-serif;
    background: linear-gradient(135deg, #f0f4f8, #d9e2ec);
    border-radius: 20px;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  }
  
  .liquid-title {
    color: #2c3e50;
    font-size: 2rem;
    text-align: center;
    position: relative;
    overflow: hidden;
    animation: liquidFlow 4s infinite ease-in-out;
  }
  
  @keyframes liquidFlow {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
  }
  
  .liquid-container {
    margin-bottom: 20px;
    padding: 20px;
    background: rgba(255, 255, 255, 0.8);
    border-radius: 15px;
    position: relative;
    overflow: hidden;
    transition: transform 0.3s ease;
  }
  
  .liquid-container:hover {
    transform: scale(1.02);
  }
  
  .liquid-text {
    font-size: 1.5rem;
    color: #34495e;
    margin: 5px 0;
    position: relative;
    z-index: 1;
  }
  
  .liquid-message {
    font-size: 1rem;
    color: #16a085;
    margin: 10px 0 0;
    position: relative;
    z-index: 1;
    animation: messageFade 0.5s ease-in;
  }
  
  @keyframes messageFade {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  .actions {
    display: flex;
    gap: 15px;
    justify-content: center;
  }
  
  .liquid-button {
    position: relative;
    width: 150px;
    padding: 12px 20px;
    font-size: 1rem;
    color: white;
    background: #3498db;
    border: none;
    border-radius: 25px;
    cursor: pointer;
    overflow: hidden;
    transition: all 0.3s ease;
    outline: none;
  }
  
  .liquid-button.danger {
    background: #e74c3c;
  }
  
  .liquid-button:hover:not(.loading):not(:disabled) {
    transform: translateY(-3px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  }
  
  .liquid-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .button-text {
    position: relative;
    z-index: 1;
  }
  
  .ripple {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    background: rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    animation: rippleEffect 1.5s infinite;
    z-index: 0;
  }
  
  @keyframes rippleEffect {
    0% { width: 0; height: 0; opacity: 1; }
    100% { width: 200px; height: 200px; opacity: 0; }
  }
  
  .liquid-button.loading {
    pointer-events: none;
  }
  </style>