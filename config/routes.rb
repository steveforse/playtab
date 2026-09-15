Rails.application.routes.draw do
  resource :session
  get "signup", to: "registrations#new", as: :new_registration
  post "signup", to: "registrations#create", as: :registration
  resources :passwords, param: :token
  root "workspace#index"
  get "up" => "rails/health#show", as: :rails_health_check
  namespace :api do
    resources :tef_imports, only: [ :create ]
    resources :pdf_imports, only: [ :create ]
    resources :tef_exports, only: [ :create ]
    resources :songs, only: [ :index, :show, :create, :update ]
  end
end
