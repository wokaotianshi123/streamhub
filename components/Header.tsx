import React, { useState } from 'react';
import { ViewState } from '../types';
import { Icon } from './Icon';

interface HeaderProps {
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onBack: () => void;
  onSearch: (query: string) => void;
}

const Header: React.FC<HeaderProps> = ({ currentView, setView, onBack, onSearch }) => {
  const [searchValue, setSearchValue] = useState('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim()) {
      onSearch(searchValue);
      setView('SEARCH');
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 shadow-sm transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-2 sm:gap-4">
          
          {/* Logo Section */}
          <div 
            className="flex-shrink-0 flex items-center cursor-pointer group"
            onClick={() => setView('HOME')}
          >
            <div className={`mr-1 sm:mr-2 rounded-lg flex items-center justify-center transition-all duration-300 ${currentView === 'SEARCH' ? 'w-8 h-8 sm:w-10 sm:h-10 bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'text-blue-600'}`}>
              <Icon 
                name="play_circle_filled" 
                className={currentView === 'SEARCH' ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'}
                type="round"
              />
            </div>
            <h1 className="text-sm sm:text-xl font-bold tracking-tight text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors whitespace-nowrap">
              StreamHub
              <span className="hidden sm:inline">{currentView === 'HOME' && ' 视界'}</span>
            </h1>
          </div>

          {/* Search Bar Section */}
          <div className="flex-1 max-w-2xl mx-auto px-1 sm:px-0">
            <form onSubmit={handleSearchSubmit} className="relative group">
              <div className="absolute inset-y-0 left-0 pl-2 sm:pl-3 flex items-center pointer-events-none">
                <Icon name="search" className="text-gray-400 group-focus-within:text-blue-500 transition-colors text-lg sm:text-xl" />
              </div>
              <input
                type="text"
                className="block w-full pl-8 sm:pl-10 pr-2 sm:pr-3 py-1.5 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-full leading-5 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs sm:text-sm transition-all duration-300 shadow-inner"
                placeholder="搜索..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              />
            </form>
          </div>

          {/* Actions Section */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {currentView !== 'HOME' && (
              <button 
                type="button"
                className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
                onClick={onBack}
                title="返回上一页"
              >
                <Icon name="arrow_back" className="text-lg sm:text-xl" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;