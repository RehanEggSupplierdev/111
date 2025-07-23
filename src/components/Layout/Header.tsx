import React from 'react';
import { Video, Menu, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <header className="bg-white/95 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14 sm:h-16">
          <Link to="/" className="flex items-center space-x-2">
            <div className="w-8 sm:w-10 h-8 sm:h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              <Video className="w-4 sm:w-6 h-4 sm:h-6 text-white" />
            </div>
            <span className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Metstack
            </span>
            <span className="text-xs text-gray-500 ml-2 hidden lg:inline">
              © @aftabstack
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden sm:flex items-center space-x-4 lg:space-x-8">
            <Link
              to="/create-meeting"
              className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 lg:px-6 py-2 rounded-lg font-medium hover:from-blue-600 hover:to-purple-700 transition-all transform hover:scale-105 text-sm lg:text-base"
            >
              Create Meeting
            </Link>
          </nav>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="sm:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            {mobileMenuOpen ? (
              <X className="w-6 h-6 text-gray-600" />
            ) : (
              <Menu className="w-6 h-6 text-gray-600" />
            )}
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="sm:hidden border-t border-gray-200 py-4">
            <nav className="flex flex-col space-y-3">
              <Link
                to="/create-meeting"
                onClick={() => setMobileMenuOpen(false)}
                className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-3 rounded-lg font-medium hover:from-blue-600 hover:to-purple-700 transition-all text-center"
              >
                Create Meeting
              </Link>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}