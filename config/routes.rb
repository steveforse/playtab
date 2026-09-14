Rails.application.routes.draw do
  root "workspace#index"
  get "up" => "rails/health#show", as: :rails_health_check
  namespace :api do
    resources :tef_imports, only: [ :create ]
    resources :tef_exports, only: [ :create ]
    resources :songs, only: [ :index, :show, :create, :update ]
  end
end
